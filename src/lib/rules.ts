import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { skillsDir } from './skills.js';
import { DEV_ROLE, GENERAL, type Selection } from './sections.js';

/**
 * Rules do harness — convenções versionadas no `nio-skills`, na mesma taxonomia
 * da seleção: `rules/<role>/<área|general>/<stack|general>/rules.md`. O geral do role
 * fica em `rules/<role>/general/general-rules.md`.
 *
 * Este módulo lê + concatena (determinístico) pela `Selection`, e o CLI grava o
 * resultado no repo (`docs/_rules`). Rules são de código → só o role `dev`.
 */

const RULES_ROOT = 'rules';

function rulePath(dir: string, ...seg: string[]): string {
  return join(dir, RULES_ROOT, ...seg);
}

/** Separa o frontmatter (`--- … ---`) do corpo. */
function splitFrontmatter(raw: string): { fm: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!m) return { fm: {}, body: raw };
  const fm: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const mm = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (mm) fm[mm[1]] = mm[2].trim();
  }
  return { fm, body: raw.slice(m[0].length) };
}

/** Rebaixa headings um nível (`##` → `###`) pra aninharem sob o cabeçalho do bloco. */
function demoteHeadings(md: string): string {
  return md.replace(/^(#{1,5})(\s)/gm, '#$1$2');
}

/** Corpo (sem frontmatter, headings rebaixados) de um arquivo de regra, ou `null`. */
function readRuleBody(path: string): string | null {
  if (!existsSync(path)) return null;
  const body = splitFrontmatter(readFileSync(path, 'utf8')).body.trim();
  return body.length > 0 ? demoteHeadings(body) : null;
}

/** Skills recomendadas (frontmatter `skills:`) de um arquivo de regra. */
function ruleSkillsAt(path: string): string[] {
  if (!existsSync(path)) return [];
  return (splitFrontmatter(readFileSync(path, 'utf8')).fm.skills ?? '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Arquivo de regra geral do role (`rules/<role>/general/general-rules.md`, ou `rules.md`). */
function generalRule(dir: string): string {
  const named = rulePath(dir, DEV_ROLE, GENERAL, 'general-rules.md');
  return existsSync(named) ? named : rulePath(dir, DEV_ROLE, GENERAL, 'rules.md');
}

/**
 * Concatena o harness pela seleção: geral do role + (por área selecionada) o geral da
 * área + o **stack** escolhido. Ordenado (general → áreas alfabéticas). String vazia se
 * nada aplicável. Só o role `dev` tem rules.
 */
export function concatenateRules(sel: Selection, dir: string = skillsDir()): string {
  if (!sel.roles.includes(DEV_ROLE)) return '';
  const blocks: string[] = [];

  const general = readRuleBody(generalRule(dir));
  if (general) blocks.push(`## general\n\n${general}`);

  for (const area of Object.keys(sel.stacks).sort()) {
    const areaGeneral = readRuleBody(rulePath(dir, DEV_ROLE, area, GENERAL, 'rules.md'));
    if (areaGeneral) blocks.push(`## ${area}\n\n${areaGeneral}`);

    const stack = sel.stacks[area];
    if (stack && stack !== GENERAL) {
      const body = readRuleBody(rulePath(dir, DEV_ROLE, area, stack, 'rules.md'));
      if (body) blocks.push(`## ${area} · ${stack}\n\n${body}`);
    }
  }

  return blocks.join('\n\n');
}

/**
 * Skills recomendadas (skills.sh, do frontmatter `skills:`) das áreas/stacks
 * selecionadas — do `rules.md` da área + do stack escolhido. Deduplicado.
 */
export function collectRuleSkills(sel: Selection, dir: string = skillsDir()): string[] {
  if (!sel.roles.includes(DEV_ROLE)) return [];
  const out = new Set<string>();
  for (const area of Object.keys(sel.stacks)) {
    for (const s of ruleSkillsAt(rulePath(dir, DEV_ROLE, area, GENERAL, 'rules.md'))) out.add(s);
    const stack = sel.stacks[area];
    if (stack && stack !== GENERAL) {
      for (const s of ruleSkillsAt(rulePath(dir, DEV_ROLE, area, stack, 'rules.md'))) out.add(s);
    }
  }
  return [...out];
}
