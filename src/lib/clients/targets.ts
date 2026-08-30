import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { toSkillDocs, type SkillDoc } from '../skills/skills.js';
import { readJson } from '../file-merge.js';
import type { ProvisionInputDoc } from '../provision/provision.js';
import { brand } from '../../brand.js';

/**
 * Um "alvo" de provisionamento: um cliente de IA com seu diretório nativo e como os
 * docs viram arquivos ali. O núcleo (`applyProvision`) é agnóstico — cada alvo só
 * define onde escrever (`targetDir`) e como traduzir os docs crus (`mapDocs`).
 */
export interface ProvisionTarget {
  id: 'claude' | 'codex' | 'opencode';
  label: string;
  /** Surface pra filtro de visibilidade por cliente (`clients:` do frontmatter). */
  surface: string;
  /** Diretório nativo do cliente (ex.: `~/.claude`). */
  targetDir(): string;
  /** Traduz os docs crus do pacote pro layout on-disk deste cliente. */
  mapDocs(docs: ProvisionInputDoc[]): ProvisionInputDoc[];
}

export const claudeTarget: ProvisionTarget = {
  id: 'claude',
  label: 'Claude Code (~/.claude)',
  surface: 'claude-code',
  targetDir: () => join(homedir(), '.claude'),
  mapDocs: (docs) => docs,
};

/**
 * Texto que substitui `$ARGUMENTS` na tradução pro Codex. Skills do Codex são
 * selecionadas por descrição e dirigidas por linguagem natural — não há
 * substituição de slash-args como no caminho de command/prompt do Claude.
 */
const ARGS_REWORD = 'the arguments the user provided';

/** Escapa uma descrição pra uma linha de YAML entre aspas duplas. */
function yamlQuote(value: string): string {
  const oneLine = value.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
  return `"${oneLine.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Renderiza o SKILL.md de um node no formato Agent Skills (name + description). */
export function toCodexSkillContent(node: SkillDoc): string {
  const description = node.frontmatter.description || node.description || node.title;
  const frontmatter = `---\nname: ${node.id}\ndescription: ${yamlQuote(description)}\n---\n`;

  let body = node.content;
  if (body.includes('$ARGUMENTS')) {
    body = body.split('$ARGUMENTS').join(ARGS_REWORD);
  }

  // `argument-hint` não existe em skills — dobra num aviso de entrada esperada.
  const hint = node.frontmatter['argument-hint'];
  const inputLine = hint ? `**Expected input:** ${hint}\n\n` : '';

  return `${frontmatter}\n${inputLine}${body.trim()}\n`;
}

/**
 * Renderiza um custom prompt do Codex (`~/.codex/prompts/<id>.md`). Diferente da skill,
 * o Codex expande `$ARGUMENTS`/`$1..$9` aqui, então preservamos os placeholders.
 */
export function toCodexPromptContent(node: SkillDoc): string {
  const description = node.frontmatter.description || node.description || node.title;
  const hint = node.frontmatter['argument-hint'];
  const fmLines = [`description: ${yamlQuote(description)}`];
  if (hint) fmLines.push(`argument-hint: ${yamlQuote(hint)}`);
  const frontmatter = `---\n${fmLines.join('\n')}\n---\n`;

  // Corpo original, com `$ARGUMENTS`/`$1` intactos (o Codex substitui na invocação).
  return `${frontmatter}\n${node.content.trim()}\n`;
}

/**
 * Traduz os docs crus pro layout do Codex em dual-write: cada `command`/`skill` vira
 * uma skill (`skills/<id>/SKILL.md`) E um custom prompt (`prompts/<id>.md`). Os
 * arquivos de apoio de uma skill (`templates/*.md`, `*-PATTERN.md`, `STANDARDS.md` —
 * type `doc`, vizinhos do `SKILL.md`) são carregados pra dentro de `skills/<id>/`
 * preservando o path relativo, pra que o SKILL.md traduzido consiga referenciá-los
 * exatamente como no Claude. `agent` e `doc` fora de uma skill são ignorados.
 */
export function toCodexDocs(docs: ProvisionInputDoc[]): ProvisionInputDoc[] {
  const nodes = toSkillDocs(
    docs.map((d) => ({ path: d.relPath, raw: d.content.toString('utf8') })),
  );
  const rawByPath = new Map(docs.map((d) => [d.relPath, d.content]));

  // Pasta da skill (dir do SKILL.md) -> id, pra rotear os arquivos de apoio.
  const skillFolders = new Map<string, string>();
  for (const node of nodes) {
    if (node.type === 'skill') {
      skillFolders.set(node.path.slice(0, node.path.lastIndexOf('/')), node.id);
    }
  }

  const out: ProvisionInputDoc[] = [];
  const seen = new Map<string, string>(); // id -> path de origem (guarda de colisão)

  for (const node of nodes) {
    if (node.type === 'command' || node.type === 'skill') {
      const prev = seen.get(node.id);
      if (prev) {
        throw new Error(
          `Tradução Codex: id duplicado "${node.id}" (${prev} e ${node.path}). ` +
            `O id precisa ser único — renomeie um deles.`,
        );
      }
      seen.set(node.id, node.path);

      out.push({
        relPath: `skills/${node.id}/SKILL.md`,
        content: Buffer.from(toCodexSkillContent(node), 'utf8'),
      });
      out.push({
        relPath: `prompts/${node.id}.md`,
        content: Buffer.from(toCodexPromptContent(node), 'utf8'),
      });
      continue;
    }

    // Arquivo de apoio de uma skill: carrega verbatim pro dir da skill traduzida,
    // mantendo o path relativo (ex.: `templates/spec.md`, `SPEC-PATTERN.md`).
    if (node.type === 'doc') {
      for (const [folder, id] of skillFolders) {
        if (!node.path.startsWith(`${folder}/`)) continue;
        const rel = node.path.slice(folder.length + 1);
        const raw = rawByPath.get(node.path);
        if (raw) out.push({ relPath: `skills/${id}/${rel}`, content: raw });
        break;
      }
    }
  }

  return out;
}

export const codexTarget: ProvisionTarget = {
  id: 'codex',
  label: 'Codex CLI (~/.codex)',
  surface: 'codex',
  targetDir: () => join(homedir(), '.codex'),
  mapDocs: (docs) => toCodexDocs(docs),
};

/** OpenCode reaproveita o mesmo layout on-disk do pacote de skills (`skills/<id>/SKILL.md`,
 * `commands/<id>.md`) — sem tradução, igual ao Claude Code. */
export const opencodeTarget: ProvisionTarget = {
  id: 'opencode',
  label: 'OpenCode (~/.config/opencode)',
  surface: 'opencode',
  targetDir: () => join(homedir(), '.config', 'opencode'),
  mapDocs: (docs) => docs,
};

// Só OpenCode por enquanto (decisão de 2026-07-27) — claudeTarget/codexTarget
// seguem definidos acima (não apagados) mas fora da lista ativa.
export const ALL_TARGETS: ProvisionTarget[] = [opencodeTarget];

function opencodeConfigured(): boolean {
  const path = join(homedir(), '.config', 'opencode', 'opencode.json');
  if (!existsSync(path)) return false;
  try {
    const json = (readJson(path) ?? {}) as { mcp?: Record<string, unknown> };
    return Boolean(json.mcp?.[brand.mcpServerKey]);
  } catch {
    return false;
  }
}

/**
 * Alvos que já têm o servidor `nio` configurado (~/.config/opencode/opencode.json).
 * Base do auto-detect de `sync`: provisiona pra cada cliente que o worker de
 * fato usa, sem flags.
 */
export function detectConfiguredTargets(): ProvisionTarget[] {
  const targets: ProvisionTarget[] = [];
  if (opencodeConfigured()) targets.push(opencodeTarget);
  return targets;
}
