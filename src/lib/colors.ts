import chalk from 'chalk';
import boxen, { type Options as BoxenOptions } from 'boxen';
import { envName } from '../brand.js';

/**
 * Camada de estilo do CLI. `chalk` cuida de cor (respeita TTY / `NO_COLOR` /
 * `FORCE_COLOR` sozinho) e `boxen` desenha caixas. Helpers extras: links
 * clicáveis (OSC 8), régua, símbolos e realce de comandos.
 */

/** Paleta — `chalk` já é um objeto com `.bold/.dim/.cyan/...`, reexpomos como `c`. */
export const c = chalk;

/** Símbolos usados na saída (unicode). */
export const sym = {
  ok: '✓',
  err: '✗',
  dot: '●',
  arrow: '→',
  chevron: '›',
  bullet: '·',
  warn: '⚠',
  gear: '↻',
};

/** Comando destacado (ciano) — o realce padrão pra qualquer coisa executável. */
export function cmd(s: string): string {
  return chalk.cyan(s);
}

/** Selo com fundo colorido — estado bem visível ao lado de um título. */
export function badge(
  label: string,
  color: 'green' | 'yellow' | 'gray' | 'cyan' = 'gray',
): string {
  const bg = {
    green: chalk.bgGreen,
    yellow: chalk.bgYellow,
    gray: chalk.bgGray,
    cyan: chalk.bgCyan,
  }[color];
  return bg.black(` ${label} `);
}

/** Régua horizontal fina. */
export function rule(width = 58): string {
  return chalk.dim('─'.repeat(width));
}

/** Realça trechos `entre crases` como comandos (ciano) e remove as crases. */
export function highlightInlineCode(s: string): string {
  return s.replace(/`([^`]+)`/g, (_m, code: string) => chalk.cyan(code));
}

/**
 * Link clicável via OSC 8 (terminais modernos). Fora de TTY, cai pra
 * `label (url)` em texto plano. Sublinhado em ciano pra parecer link.
 */
export function link(url: string, label = url): string {
  if (!process.stdout.isTTY) return label === url ? url : `${label} (${url})`;
  const OSC = ']8;;';
  const BEL = '';
  return `${OSC}${url}${BEL}${chalk.cyan.underline(label)}${OSC}${BEL}`;
}

/** Caixa (boxen) com defaults do nio; opções sobrescrevíveis. */
export function box(content: string, opts: BoxenOptions = {}): string {
  return boxen(content, {
    padding: { top: 0, bottom: 0, left: 1, right: 1 },
    borderStyle: 'round',
    borderColor: 'gray',
    dimBorder: true,
    ...opts,
  });
}

/** Indenta cada linha de um bloco multi-linha (ex.: pra alinhar uma caixa). */
export function indent(block: string, spaces = 2): string {
  const pad = ' '.repeat(spaces);
  return block
    .split('\n')
    .map((l) => (l.length ? pad + l : l))
    .join('\n');
}

/** Título de seção proeminente: negrito + sublinhado, com subtítulo dim opcional. */
export function sectionTitle(title: string, subtitle?: string): string {
  const head = chalk.bold.underline(title);
  return subtitle ? `${head}  ${chalk.dim(subtitle)}` : head;
}

/**
 * Limpa a **tela visível** e volta o cursor pro topo — sem apagar o histórico de
 * rolagem (`\x1b[2J\x1b[H`, não `\x1b[3J`), então dá pra rolar pra cima e revisar.
 * Só em TTY; desliga com a env `NO_CLEAR` prefixada da marca (ex.: `NIO_NO_CLEAR=1`).
 */
export function clearScreen(): void {
  if (!process.stdout.isTTY || process.env[envName('NO_CLEAR')]) return;
  process.stdout.write("\x1b[2J\x1b[H");
}

/** Começa uma seção "em tela nova": limpa (se TTY) e imprime o título. */
export function section(title: string, subtitle?: string): void {
  clearScreen();
  console.log(sectionTitle(title, subtitle));
}
