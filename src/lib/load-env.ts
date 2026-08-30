/**
 * Carrega variáveis de `.env` nos binários (rodam sob `node`, que não lê `.env`
 * sozinho). Importe PRIMEIRO, antes de qualquer módulo que leia env no topo.
 *
 * Precedência: env do shell > `$NIO_ENV_FILE` > `.env` do diretório atual >
 * `~/.nio/config.env`. Nunca sobrescreve valor já presente no ambiente.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

const debug = /^(1|true|yes|on)$/i.test((process.env.NIO_DEBUG ?? '').trim());

/** `process.loadEnvFile` (Node 20.12+) existe? Sob Bun / Node antigo, não. */
const nodeLoad = (process as { loadEnvFile?: (p: string) => void }).loadEnvFile;

/** Parser mínimo `KEY=value` (fallback quando `process.loadEnvFile` não existe). */
function parseAndApply(text: string): void {
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    if (process.env[key] === undefined) {
      process.env[key] = line.slice(eq + 1).trim();
    }
  }
}

function tryLoad(path: string): void {
  if (!existsSync(path)) {
    if (debug) console.error(`[nio:debug] env ausente: ${path}`);
    return;
  }
  try {
    if (nodeLoad) nodeLoad(path);
    else parseAndApply(readFileSync(path, 'utf8'));
    if (debug) console.error(`[nio:debug] env carregado: ${path}`);
  } catch (err) {
    if (debug) console.error(`[nio:debug] env falhou (${(err as Error).message}): ${path}`);
  }
}

const explicit = process.env.NIO_ENV_FILE?.trim();
if (explicit) tryLoad(explicit);
tryLoad(join(process.cwd(), '.env'));
tryLoad(join(homedir(), '.nio', 'config.env'));
