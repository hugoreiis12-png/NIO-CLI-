/**
 * Log de debug da TUI. **Nunca escreve no console** enquanto o Ink está montado
 * (isso corrompe o render) — vai pra `~/.nio/tui.log` quando `NIO_DEBUG=1`.
 */
import { appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEBUG } from '../lib/debug.js';

const FILE = join(homedir(), '.nio', 'tui.log');

export function tlog(...args: unknown[]): void {
  if (!DEBUG) return;
  try {
    // 2000 chars/arg: o antigo teto de 200 cortava o payload dos parts (ex.: o
    // `text` de uma compaction), cegando o debug. Longo o bastante sem virar dump.
    const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a).slice(0, 2000))).join(' ');
    appendFileSync(FILE, `${new Date().toISOString()} ${line}\n`);
  } catch {
    /* best-effort */
  }
}

export const TUI_LOG_FILE = FILE;
