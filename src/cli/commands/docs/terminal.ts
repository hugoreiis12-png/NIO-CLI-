/**
 * Renderiza a documentação (`content.ts` + seções dinâmicas) no terminal, com
 * as cores do `colors.ts`. Saída pra stdout, paginável (`nio docs | less -R`).
 */
import { c, sym, rule, highlightInlineCode, indent } from '../../../lib/colors.js';
import type { Block, DocSection } from './content.js';

/** Bloco de código: barra fina à esquerda, sem quebra de linha forçada. */
function codeBlock(text: string): string {
  return text
    .split('\n')
    .map((l) => `${c.dim('│')} ${c.cyan(l)}`)
    .join('\n');
}

/** Tabela vira lista `termo — descrição` (sem largura fixa, não estoura o terminal). */
function defList(head: string[], rows: string[][]): string {
  return rows
    .map((r) => {
      const term = c.bold(r[0] ?? '');
      const rest = r.slice(1).map((cell) => highlightInlineCode(cell)).join(' — ');
      return rest ? `${term}\n${indent(c.dim(rest), 2)}` : term;
    })
    .join('\n');
}

function renderBlock(b: Block): string {
  switch (b.kind) {
    case 'p':
      return highlightInlineCode(b.text);
    case 'code':
      return codeBlock(b.text);
    case 'list':
      return b.items.map((it) => `${c.dim(sym.bullet)} ${highlightInlineCode(it)}`).join('\n');
    case 'table':
      return defList(b.head, b.rows);
  }
}

export function renderTerminal(sections: DocSection[], version: string): string {
  const parts: string[] = [c.bold(`NIO-CLI  ${c.dim('v' + version)}`), ''];
  for (const s of sections) {
    parts.push(rule(), c.bold.underline(s.title.toUpperCase()));
    if (s.blurb) parts.push(c.dim(s.blurb));
    parts.push('');
    for (const b of s.blocks) parts.push(indent(renderBlock(b), 2), '');
  }
  parts.push(rule(), c.dim('Página com arte: nio docs --html --open'));
  return parts.join('\n');
}
