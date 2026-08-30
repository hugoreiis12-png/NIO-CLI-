/**
 * Seções geradas ao vivo da fonte: a árvore de comandos (do `program` do
 * commander) e as tools MCP (de `toolDefinitions`). Assim `nio docs` nunca
 * diverge do que a CLI de fato expõe.
 */
import type { Command } from 'commander';
import { toolDefinitions } from '../../../tools/index.js';
import type { DocSection } from './content.js';

/** Primeira frase de um texto — resumo enxuto pra tabela. */
function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const stop = flat.search(/\.(\s|$)/);
  return stop > 0 ? flat.slice(0, stop + 1) : flat;
}

function walk(cmd: Command, prefix = ''): string[][] {
  const rows: string[][] = [];
  for (const sub of cmd.commands) {
    const nm = sub.name();
    if (nm === 'help') continue;
    const full = prefix ? `${prefix} ${nm}` : nm;
    const args =
      sub.commands.length > 0 ? '' : sub.usage().replace(/^\[options\]\s*/, '').trim();
    const desc = sub.description();
    if (desc) rows.push([args ? `${full} ${args}` : full, firstSentence(desc)]);
    rows.push(...walk(sub, full));
  }
  return rows;
}

export function commandSection(program: Command): DocSection {
  const rows = walk(program).sort((a, b) => a[0]!.localeCompare(b[0]!));
  return {
    id: 'comandos',
    title: 'Comandos',
    blurb: `${rows.length} comandos. Ajuda de qualquer um: nio <cmd> --help`,
    blocks: [{ kind: 'table', head: ['Comando', 'O que faz'], rows }],
  };
}

export function toolSection(): DocSection {
  const rows = [...toolDefinitions]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => [t.name, firstSentence(t.description ?? '')]);
  return {
    id: 'tools-mcp',
    title: 'Tools MCP',
    blurb: 'Expostas pelo servidor nio-cli ao operador de IA. Todas passam pelo SessionManager e exigem nio login.',
    blocks: [{ kind: 'table', head: ['Tool', 'O que faz'], rows }],
  };
}
