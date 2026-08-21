import { readSkillFiles, toSkillDocs, type SkillDoc, type SkillDocType } from './skills.js';
import { brand } from '../brand.js';

/**
 * Camada de **serviço** do pacote de skills pro servidor MCP: expõe os docs como
 * resources (leitura sob demanda) e como prompts (slash/commands no Cowork e Codex).
 * Só o `mcp-server.ts` importa isto — o CLI nunca precisa.
 */

export const SKILLS_URI_PREFIX = `${brand.name}://skills/`;

export interface LoadedSkills {
  docs: SkillDoc[];
  /** markdown cru por path, pra `readSkillResource`. */
  rawByPath: Map<string, string>;
}

let cache: LoadedSkills | null = null;

/** Carrega o pacote de skills, memoizado (não muda enquanto o processo roda). */
export function loadSkills(dir?: string): LoadedSkills {
  if (cache && !dir) return cache;
  const files = readSkillFiles(dir);
  const loaded: LoadedSkills = {
    docs: toSkillDocs(files),
    rawByPath: new Map(files.map((f) => [f.path, f.raw])),
  };
  if (!dir) cache = loaded;
  return loaded;
}

/** Limpa o cache (testes / dir custom). */
export function clearSkillsCache(): void {
  cache = null;
}

export interface SkillResourceDescriptor {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

/**
 * Nome do resource em estilo caminho — agrupa a listagem por tipo/skill (como o
 * conector do Figma), em vez de despejar títulos soltos. Skills e commands viram
 * `skill/<id>` / `command/<id>`; arquivos de apoio (templates, *-PATTERN) aninham
 * sob a skill dona (`skill/init-sdd/templates/spec`); docs soltos viram `doc/<path>`.
 */
function resourceName(doc: SkillDoc, skillFolders: Map<string, string>): string {
  if (doc.type === 'command') return `command/${doc.id}`;
  if (doc.type === 'agent') return `agent/${doc.id}`;
  if (doc.type === 'dependency') return `dependency/${doc.id}`;
  if (doc.type === 'skill') return `skill/${doc.id}`;

  // doc: aninha sob a skill dona, se estiver dentro da pasta de uma.
  for (const [folder, id] of skillFolders) {
    if (doc.path.startsWith(`${folder}/`)) {
      const sub = doc.path.slice(folder.length + 1).replace(/\.md$/i, '');
      return `skill/${id}/${sub}`;
    }
  }
  return `doc/${doc.path.replace(/\.md$/i, '')}`;
}

export function skillResourceDescriptors(docs: SkillDoc[]): SkillResourceDescriptor[] {
  // Pasta (dir do SKILL.md) → id, pra aninhar os arquivos de apoio sob a skill.
  const skillFolders = new Map<string, string>();
  for (const d of docs) {
    if (d.type === 'skill') skillFolders.set(d.path.slice(0, d.path.lastIndexOf('/')), d.id);
  }

  return docs
    // `command`/`skill` já são servidos como **prompts** — não repetir como resource
    // (senão o Cowork lista cada um duas vezes). Aqui ficam só os arquivos de apoio
    // (templates/patterns), agents e dependencies.
    .filter((d) => d.type !== 'command' && d.type !== 'skill')
    .map((d) => ({
      uri: `${SKILLS_URI_PREFIX}${d.path}`,
      name: resourceName(d, skillFolders),
      description: d.description || d.title,
      mimeType: 'text/markdown',
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface SkillResourceContent {
  uri: string;
  mimeType: string;
  text: string;
}

/** Lê um resource pela URI, a partir dos docs + os markdowns crus por path. */
export function readSkillResource(
  uri: string,
  docs: SkillDoc[],
  rawByPath: Map<string, string>,
): SkillResourceContent {
  if (!uri.startsWith(SKILLS_URI_PREFIX)) throw new Error(`URI fora do pacote de skills: ${uri}`);
  const rel = uri.slice(SKILLS_URI_PREFIX.length);
  const doc = docs.find((d) => d.path === rel);
  if (!doc) throw new Error(`Recurso não encontrado: ${uri}`);
  return { uri, mimeType: 'text/markdown', text: rawByPath.get(rel) ?? doc.content };
}

export interface SkillPromptArgument {
  name: string;
  description?: string;
  required: boolean;
}

export interface SkillPromptDescriptor {
  name: string;
  description: string;
  arguments: SkillPromptArgument[];
}

/** Só `command` e `skill` viram prompts (docs/agents/dependencies não). */
function isPromptable(type: SkillDocType): boolean {
  return type === 'command' || type === 'skill';
}

export function skillPromptDescriptors(docs: SkillDoc[]): SkillPromptDescriptor[] {
  return docs
    .filter((d) => isPromptable(d.type))
    .map((d) => ({
      name: d.id,
      description: `[${d.type}] ${d.description || d.title}`.slice(0, 200),
      arguments: [
        {
          name: 'args',
          description: d.frontmatter['argument-hint'] || 'Argumentos opcionais passados ao prompt.',
          required: false,
        },
      ],
    }));
}

/** Monta o texto de um prompt: corpo do doc com `$ARGUMENTS` substituído. */
export function buildSkillPrompt(
  name: string,
  args: Record<string, string> | undefined,
  docs: SkillDoc[],
): { description: string; text: string } {
  const doc = docs.find((d) => d.id === name && isPromptable(d.type));
  if (!doc) throw new Error(`Prompt desconhecido: ${name}`);
  let text = doc.content.split('$ARGUMENTS').join(args?.args ?? '');

  // Cowork/Codex servem a skill como **prompt** — não têm o filesystem dela. Então os
  // arquivos de apoio (`templates/*`, `*-PATTERN.md`, `STANDARDS.md`) que o corpo
  // referencia por path relativo não existem lá. Inline-os pra a skill ficar
  // auto-contida (no Claude Code isso não roda — lá os arquivos são nativos).
  if (doc.type === 'skill') {
    const folder = doc.path.slice(0, doc.path.lastIndexOf('/'));
    const companions = docs
      .filter((d) => d.type === 'doc' && d.path.startsWith(`${folder}/`))
      .sort((a, b) => a.path.localeCompare(b.path));
    if (companions.length > 0) {
      const blocks = companions
        .map((comp) => {
          const rel = comp.path.slice(folder.length + 1);
          return `\n\n---\n\n### Arquivo de apoio da skill: \`${rel}\`\n\n${comp.content.trim()}`;
        })
        .join('');
      text +=
        `\n\n<!-- Arquivos de apoio inline: o Cowork/Codex não têm o filesystem da ` +
        `skill; use estes no lugar das referências por path relativo acima. -->${blocks}`;
    }
  }

  return { description: doc.description || doc.title, text };
}
