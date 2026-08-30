import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { brand } from '../../brand.js';
import { dirname, join } from 'node:path';

/**
 * Grava o **harness** de código no repo (versionado, do time): o arquivo de rules
 * concatenadas + as âncoras no `AGENTS.md` (com o bloco de overview do NOS) + um
 * `CLAUDE.md` fino. Idempotente e não-destrutivo: só reescreve o que é do nio; o
 * texto do time no `AGENTS.md` (fora do bloco marcado) é preservado.
 */

export const HARNESS_RULES_REL = `docs/_rules/${brand.name}.md`;
export const HARNESS_PATTERNS_REL = 'docs/_patterns.md';
const AGENTS_REL = 'AGENTS.md';
const CLAUDE_REL = 'CLAUDE.md';
const OV_START = `<!-- ${brand.name}:overview:start -->`;
const OV_END = `<!-- ${brand.name}:overview:end -->`;

export type FileAction = 'created' | 'updated' | 'unchanged' | 'empty';

export interface HarnessResult {
  rules: FileAction;
  agents: FileAction;
  claude: FileAction;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function writeIfChanged(path: string, content: string): FileAction {
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf8');
    return 'created';
  }
  if (readFileSync(path, 'utf8') === content) return 'unchanged';
  writeFileSync(path, content, 'utf8');
  return 'updated';
}

/** Insere um bloco logo após o primeiro heading `# …`, ou no topo se não houver. */
function insertAfterTitle(text: string, block: string): string {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => /^#\s/.test(l));
  if (i === -1) return `${block}\n${text}`;
  lines.splice(i + 1, 0, '', block);
  return lines.join('\n');
}

/** Garante o bloco de overview (marcado) + as âncoras `@` no `AGENTS.md`. */
function ensureAgents(path: string, overview: string | null): FileAction {
  const anchors = [`@${HARNESS_RULES_REL}`, `@${HARNESS_PATTERNS_REL}`];
  const ovBlock = overview
    ? `${OV_START}\n## Sobre o projeto\n\n${overview.trim()}\n${OV_END}`
    : null;

  if (!existsSync(path)) {
    const ov = ovBlock ? `${ovBlock}\n\n` : '';
    const content = `# AGENTS.md\n\n${ov}## Harness\n\n${anchors.join('\n')}\n`;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf8');
    return 'created';
  }

  let text = readFileSync(path, 'utf8');
  const before = text;

  if (ovBlock) {
    const re = new RegExp(`${escapeRe(OV_START)}[\\s\\S]*?${escapeRe(OV_END)}`);
    text = re.test(text) ? text.replace(re, ovBlock) : insertAfterTitle(text, ovBlock);
  }

  for (const line of anchors) {
    if (!text.split('\n').some((l) => l.trim() === line)) {
      text = `${text.trimEnd()}\n${line}\n`;
    }
  }

  if (text === before) return 'unchanged';
  writeFileSync(path, text, 'utf8');
  return 'updated';
}

/**
 * Escreve o harness no repo (`cwd`). `rulesMarkdown` vem do concatenador; `overview` é
 * o texto do NOS (opcional — quando ausente, o bloco de overview não é tocado).
 */
export function writeRepoHarness(
  cwd: string,
  opts: { rulesMarkdown: string; overview?: string | null },
): HarnessResult {
  const result: HarnessResult = { rules: 'empty', agents: 'unchanged', claude: 'unchanged' };

  // 1. docs/_rules/<nome-da-marca>.md — totalmente do nio.
  if (opts.rulesMarkdown.trim()) {
    const header =
      `# Harness de código — ${brand.name}\n\n` +
      `<!-- Gerado por \`${brand.name} sync\`. Não edite à mão — rode \`${brand.name} sync\`. -->\n\n`;
    result.rules = writeIfChanged(
      join(cwd, HARNESS_RULES_REL),
      `${header}${opts.rulesMarkdown.trim()}\n`,
    );
  }

  // 2. AGENTS.md — overview (bloco marcado) + âncoras.
  result.agents = ensureAgents(join(cwd, AGENTS_REL), opts.overview ?? null);

  // 3. CLAUDE.md fino — scaffold-if-missing.
  const claudePath = join(cwd, CLAUDE_REL);
  if (!existsSync(claudePath)) {
    writeFileSync(claudePath, `@${AGENTS_REL}\n`, 'utf8');
    result.claude = 'created';
  }

  return result;
}
