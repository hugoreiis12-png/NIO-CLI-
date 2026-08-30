#!/usr/bin/env bun
/**
 * Gera as listagens de referência do README a partir da FONTE (registry de tools +
 * árvore de comandos do CLI) + `src/brand.ts`, e injeta entre marcadores:
 *   - tools    → `<!-- TOOLS:START -->` / `<!-- TOOLS:END -->`
 *   - comandos → `<!-- COMMANDS:START -->` / `<!-- COMMANDS:END -->`
 *
 * Brand-adaptável: os nomes vão SEM prefixo (neutros); o prefixo (`brand.toolPrefix`/
 * `cliToolPrefix`) e o binário (`brand.name`) são declarados uma vez. Rebrand = editar
 * `brand.ts` e rodar `bun run gen:docs`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { toolDefinitions } from '../src/tools/index.ts';
import { brand } from '../src/brand.ts';
import { registerAuthCommands } from '../src/cli/commands/auth.ts';
import { registerInitCommand } from '../src/cli/commands/init/index.ts';
import { registerSyncCommand } from '../src/cli/commands/sync.ts';
import { registerSkillsCommands } from '../src/cli/commands/skills.ts';
import { registerCleanCommand } from '../src/cli/commands/clean.ts';
import { registerExecCommand } from '../src/cli/commands/exec.ts';
import { registerPlanCommand } from '../src/cli/commands/plan.ts';
import { registerValidatePlanCommand } from '../src/cli/commands/validate-plan.ts';
import { registerCompletionCommand } from '../src/cli/commands/completion.ts';
import { registerDockerCommand } from '../src/cli/commands/docker.ts';
import { registerSecurityCommands } from '../src/cli/commands/security.ts';
import { registerDocsCommand } from '../src/cli/commands/docs.ts';
import { registerConfigCommand } from '../src/cli/commands/config.ts';

/** Primeira frase de um texto (resumo enxuto pra tabela), com `|` escapado. */
function cell(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const stop = flat.search(/\.(\s|$)/);
  const sentence = stop > 0 ? flat.slice(0, stop + 1) : flat;
  return sentence.replace(/\|/g, '\\|');
}

/** `código` de tabela, com `|` escapado. */
function code(text: string): string {
  return `\`${text.replace(/\|/g, '\\|')}\``;
}

const AUTO_LINE = '<!-- gerado por `bun run gen:docs` — não edite à mão. -->';

// ---------- Tools (MCP) ----------

function genTools(): string {
  type Group = { title: string; prefix: string; rows: { op: string; what: string }[] };
  const groups: Group[] = [
    { title: 'Tools de produto', prefix: brand.toolPrefix, rows: [] },
    { title: 'Tools que espelham o CLI', prefix: brand.cliToolPrefix, rows: [] },
  ];
  const other: Group = { title: 'Outras', prefix: '', rows: [] };

  for (const def of toolDefinitions) {
    const g = groups.find((x) => def.name.startsWith(x.prefix)) ?? other;
    const op = g.prefix ? def.name.slice(g.prefix.length) : def.name;
    g.rows.push({ op, what: cell(def.description ?? '') });
  }
  if (other.rows.length) groups.push(other);

  const out: string[] = [`${AUTO_LINE.slice(0, -4)} ${toolDefinitions.length} tools. -->`];
  for (const g of groups) {
    if (g.rows.length === 0) continue;
    const label = g.prefix ? `${g.title} — prefixo ${code(g.prefix)}` : g.title;
    out.push('', `### ${label}`, '', '| Operação | O que faz |', '| --- | --- |');
    for (const r of g.rows.sort((a, b) => a.op.localeCompare(b.op))) {
      out.push(`| ${code(r.op)} | ${r.what} |`);
    }
  }
  return out.join('\n');
}

// ---------- Comandos (CLI) ----------

function buildProgram(): Command {
  const program = new Command();
  program.name(brand.name).description(`CLI do ${brand.productName}`);
  for (const reg of [
    registerAuthCommands,
    registerInitCommand,
    registerSyncCommand,
    registerSkillsCommands,
    registerCleanCommand,
    registerExecCommand,
    registerPlanCommand,
    registerValidatePlanCommand,
    registerCompletionCommand,
    registerDockerCommand,
    registerSecurityCommands,
    registerDocsCommand,
    registerConfigCommand,
  ]) {
    reg(program);
  }
  return program;
}

function walkCommands(cmd: Command, prefix = ''): { name: string; desc: string }[] {
  const out: { name: string; desc: string }[] = [];
  for (const sub of cmd.commands) {
    const nm = sub.name();
    if (nm === 'help') continue;
    const full = prefix ? `${prefix} ${nm}` : nm;
    // Grupos (com subcomandos) não mostram args; folhas mostram (`[pat]`, `<jobId>`…).
    const args = sub.commands.length > 0 ? '' : sub.usage().replace(/^\[options\]\s*/, '').trim();
    const display = args ? `${full} ${args}` : full;
    const desc = sub.description();
    if (desc) out.push({ name: display, desc });
    out.push(...walkCommands(sub, full));
  }
  return out;
}

function genCommands(): string {
  const cmds = walkCommands(buildProgram()).sort((a, b) => a.name.localeCompare(b.name));
  const out: string[] = [
    `${AUTO_LINE.slice(0, -4)} binário \`${brand.name}\`, ${cmds.length} comandos. -->`,
    '',
    '| Comando | Descrição |',
    '| --- | --- |',
  ];
  for (const c of cmds) out.push(`| ${code(c.name)} | ${cell(c.desc)} |`);
  return out.join('\n');
}

// ---------- Injeção ----------

function inject(md: string, tag: string, block: string): string | null {
  const start = `<!-- ${tag}:START -->`;
  const end = `<!-- ${tag}:END -->`;
  const i = md.indexOf(start);
  const j = md.indexOf(end);
  if (i < 0 || j < 0 || j < i) return null;
  return md.slice(0, i + start.length) + '\n' + block + '\n' + md.slice(j);
}

const readmePath = fileURLToPath(new URL('../README.md', import.meta.url));
let md = readFileSync(readmePath, 'utf8');
let done = 0;
for (const [tag, block] of [
  ['TOOLS', genTools()],
  ['COMMANDS', genCommands()],
] as const) {
  const next = inject(md, tag, block);
  if (next) {
    md = next;
    done++;
  } else {
    console.error(`aviso: marcadores <!-- ${tag}:START/END --> não encontrados no README.`);
  }
}
writeFileSync(readmePath, md, 'utf8');
console.error(`README: ${done} seção(ões) gerada(s).`);
