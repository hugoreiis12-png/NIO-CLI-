import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, sep, dirname } from 'node:path';
import { skillsCacheDir, skillsCached } from './skills-cache.js';
import { includePath, type Selection } from './sections.js';
import { brand, env } from '../brand.js';

/**
 * Lê o pacote `@nio-cli/skills` (skills / commands / agents / dependencies) e produz
 * os docs (frontmatter + corpo). Única fonte da verdade do conteúdo.
 *
 * Este módulo é a camada **de leitura** — consumida pelo `provision` (copia pros
 * clientes), pelo fluxo de dependências e pela telemetria. O que o servidor MCP
 * precisa pra *servir* skills como prompts/resources vive em `skill-serve.ts`.
 */

export type SkillDocType = 'command' | 'skill' | 'agent' | 'doc' | 'dependency';

export interface SkillDoc {
  /** Nome de invocação = pasta/arquivo (ex.: `implement`, `grill-me`). */
  id: string;
  /**
   * Id **sequencial estável** do frontmatter (`id:`) — chave de telemetria que
   * sobrevive a renames. `null` se o doc ainda não tem id atribuído.
   */
  uid: string | null;
  title: string;
  type: SkillDocType;
  /** Path relativo dentro do pacote, estilo POSIX, ex.: `commands/implement.md`. */
  path: string;
  description: string;
  frontmatter: Record<string, string>;
  /** Corpo markdown, sem o frontmatter. */
  content: string;
  /**
   * Clientes de IA pros quais este doc é servido (do frontmatter `clients:`).
   * `null` = todos. Valores: `claude-code` | `codex` | `cowork`.
   */
  clients: string[] | null;
}

/** Um documento cru do pacote: path relativo + markdown completo (com frontmatter). */
export interface RawDoc {
  path: string;
  raw: string;
}

/**
 * Diretório do conteúdo das skills. Resolve em ordem: `NIO_SKILLS_DIR`
 * (checkout local), `@nio-cli/skills` via require.resolve (dev legado), ou o
 * cache `~/.nio/skills` populado por `nio sync`/`init` (fluxo padrão).
 */
export function skillsDir(): string {
  const override = env('SKILLS_DIR');
  if (override && existsSync(override)) return override;

  try {
    const require = createRequire(import.meta.url);
    return dirname(require.resolve(`${brand.skillsPackage}/package.json`));
  } catch {
    /* pacote ausente (modelo repo-aberto) → cai pro cache local */
  }

  if (skillsCached()) return skillsCacheDir();

  throw new Error(
    `Conteúdo de skills não encontrado. Rode \`${brand.name} sync\` pra baixar o repo ` +
      '(ou defina NIO_SKILLS_DIR apontando pra um checkout local).',
  );
}

function listMarkdown(dir: string): string[] {
  const out: string[] = [];
  const walk = (abs: string): void => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const childAbs = join(abs, entry.name);
      if (entry.isDirectory()) walk(childAbs);
      else if (
        entry.isFile() &&
        entry.name.toLowerCase().endsWith('.md') &&
        entry.name.toLowerCase() !== 'readme.md'
      )
        out.push(relative(dir, childAbs).split(sep).join('/'));
    }
  };
  walk(dir);
  return out;
}

/**
 * Coleta as linhas indentadas/vazias seguintes (bloco YAML folded `>` ou literal `|`)
 * a partir de `lines[i + 1]`. Retorna o valor já juntado e o novo índice do cursor
 * (última linha consumida) pro chamador continuar o loop dali.
 */
function collectBlockValue(
  lines: string[],
  i: number,
  folded: boolean,
): { value: string; nextIndex: number } {
  const collected: string[] = [];
  while (i + 1 < lines.length && (lines[i + 1].trim() === '' || /^\s+\S/.test(lines[i + 1]))) {
    collected.push(lines[++i].trim());
  }
  const value = folded
    ? collected.join(' ').replace(/\s+/g, ' ').trim()
    : collected.join('\n').trim();
  return { value, nextIndex: i };
}

/** Valor entre aspas simples/duplas → sem as aspas. Sem aspas → devolve como veio. */
function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Parser de frontmatter minimalista: `key: value` de uma linha, mais blocos
 * folded (`>`) e literal (`|`). Suficiente pros metadados (não é YAML completo).
 * Exportado pro `RecipeCatalog` (`adapters/skills/`) reusar sem duplicar.
 */
export function parseFrontmatter(raw: string): { frontmatter: Record<string, string>; body: string } {
  const fm: Record<string, string> = {};
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!match) return { frontmatter: fm, body: raw };

  const lines = match[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const key = m[1];
    const value = m[2].trim();

    if (/^[|>][+-]?$/.test(value)) {
      const block = collectBlockValue(lines, i, value[0] === '>');
      fm[key] = block.value;
      i = block.nextIndex;
      continue;
    }

    fm[key] = unquote(value);
  }
  return { frontmatter: fm, body: raw.slice(match[0].length) };
}

/** Clientes de IA reconhecidos pra visibilidade de docs. */
export const KNOWN_CLIENTS = ['claude-code', 'codex', 'cowork', 'opencode'] as const;
const KNOWN_CLIENTS_SET = new Set<string>(KNOWN_CLIENTS);

/**
 * Parseia o campo `clients:` do frontmatter (lista separada por vírgula/espaço)
 * num conjunto normalizado. Vazio/ausente/sem valor válido → `null` (= todos).
 */
export function parseClients(value?: string): string[] | null {
  if (!value) return null;
  const list = value
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => KNOWN_CLIENTS_SET.has(s));
  return list.length > 0 ? [...new Set(list)] : null;
}

/** Um doc é visível pra um surface se não restringe clientes ou inclui aquele. */
export function docForSurface(doc: SkillDoc, surface: string | null): boolean {
  if (!surface) return true;
  return !doc.clients || doc.clients.includes(surface);
}

/** Recorta a lista de docs pros visíveis num surface. */
export function filterSkillsForSurface(docs: SkillDoc[], surface: string | null): SkillDoc[] {
  if (!surface) return docs;
  return docs.filter((d) => docForSurface(d, surface));
}

/**
 * Filtra docs crus (relPath+conteúdo) pros visíveis num surface. Docs sem
 * frontmatter de doc (ex.: scripts soltos) são mantidos por padrão.
 */
export function filterDocsForSurface<T extends { relPath: string; content: Buffer }>(
  docs: T[],
  surface: string | null,
): T[] {
  if (!surface) return docs;
  const parsed = toSkillDocs(docs.map((d) => ({ path: d.relPath, raw: d.content.toString('utf8') })));
  const hidden = new Set(parsed.filter((n) => !docForSurface(n, surface)).map((n) => n.path));
  return docs.filter((d) => !hidden.has(d.relPath));
}

function typeForPath(relPath: string): SkillDocType {
  const parts = relPath.split('/');
  const top = parts[0];
  const base = parts[parts.length - 1].toLowerCase();
  if (top === 'commands') return 'command';
  // Só `SKILL.md` é a skill; arquivos de apoio (STANDARDS.md, etc.) são `doc`.
  if (top === 'skills') return base === 'skill.md' ? 'skill' : 'doc';
  if (top === 'agents') return 'agent';
  if (top === 'dependencies') return 'dependency';
  return 'doc';
}

/** Id de invocação: skill = nome da pasta (SKILL.md); o resto = basename sem `.md`. */
function idForPath(relPath: string): string {
  const parts = relPath.split('/');
  const base = parts[parts.length - 1];
  if (base.toLowerCase() === 'skill.md' && parts.length >= 2) return parts[parts.length - 2];
  return base.replace(/\.md$/i, '');
}

function humanize(id: string): string {
  return id.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * "Kinds" do pacote que viram docs. `rules/`, `hooks/`, `index.md`, `README.md`,
 * `scripts/` etc. são deliberadamente ignorados — o CLI não lida com eles aqui.
 */
const SKILL_KINDS = ['commands', 'skills', 'agents', 'dependencies'] as const;

/** Lê os `.md` dos kinds do pacote (`@nio-cli/skills`) como RawDoc[]. */
export function readSkillFiles(dir: string = skillsDir()): RawDoc[] {
  if (!existsSync(dir)) {
    throw new Error(`Pacote de skills não encontrado em ${dir}. Instale/publique ${brand.skillsPackage}.`);
  }
  const docs: RawDoc[] = [];
  for (const kind of SKILL_KINDS) {
    const kindDir = join(dir, kind);
    if (!existsSync(kindDir)) continue;
    for (const rel of listMarkdown(kindDir)) {
      docs.push({ path: `${kind}/${rel}`, raw: readFileSync(join(kindDir, rel), 'utf-8') });
    }
  }
  return docs;
}

/** Constrói os docs a partir de arquivos crus (frontmatter + corpo). */
export function toSkillDocs(files: RawDoc[]): SkillDoc[] {
  return files
    .map(({ path: relPath, raw }): SkillDoc => {
      const { frontmatter, body } = parseFrontmatter(raw);
      const id = idForPath(relPath);
      return {
        id,
        uid: frontmatter.id ? String(frontmatter.id).trim() : null,
        title: frontmatter.title || frontmatter.name || humanize(id),
        type: typeForPath(relPath),
        path: relPath,
        description: frontmatter.description ?? '',
        frontmatter,
        content: body.trim(),
        clients: parseClients(frontmatter.clients),
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function readSkillDocs(dir: string = skillsDir()): SkillDoc[] {
  return toSkillDocs(readSkillFiles(dir));
}

/**
 * Docs `dependency` do pacote — libs externas que a CLI oferece instalar no fim do
 * `sync`/`init`. Escopadas pela **seleção** (role/área/stack, `general` em cascata):
 * `dev/general` sempre, mais as da área/stack escolhidos. Sem seleção → todas.
 * Best-effort: `[]` se o pacote não estiver disponível.
 */
export function readDependencies(selection?: Selection, dir: string = skillsDir()): SkillDoc[] {
  try {
    let deps = readSkillDocs(dir).filter((d) => d.type === 'dependency');
    if (selection) deps = deps.filter((d) => includePath(d.path, selection));
    return deps.sort((a, b) => a.title.localeCompare(b.title));
  } catch {
    return [];
  }
}

/**
 * Mapa `nome de invocação → id sequencial (frontmatter)`, pra telemetria estável.
 * Best-effort: mapa vazio se o `@nio-cli/skills` não estiver disponível.
 */
export function skillIdMap(dir: string = skillsDir()): Map<string, string | null> {
  const map = new Map<string, string | null>();
  try {
    for (const d of readSkillDocs(dir)) map.set(d.id, d.uid);
  } catch {
    /* @nio-cli/skills ausente → telemetria sem ids */
  }
  return map;
}
