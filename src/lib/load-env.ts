/**
 * Carrega variáveis de `.env` nos binários publicados (rodam sob `node`, que não
 * lê `.env` sozinho — só o `bun run` do dev fazia isso). Importe PRIMEIRO, antes
 * de qualquer módulo que leia env no topo (ex.: `gateway/config.ts`).
 *
 * Precedência: env do shell > `$NIO_ENV_FILE` > `.env` do diretório atual >
 * `~/.nio/config.env`. `process.loadEnvFile` nunca sobrescreve valor já definido.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const debug = /^(1|true|yes|on)$/i.test((process.env.NIO_DEBUG ?? '').trim());

function tryLoad(path: string): void {
  const had = existsSync(path);
  try {
    // Node 20.12+; ausência do arquivo lança e é ignorada de propósito.
    (process as { loadEnvFile?: (p: string) => void }).loadEnvFile?.(path);
    if (debug) console.error(`[nio:debug] env ${had ? 'carregado' : 'ausente'}: ${path}`);
  } catch {
    if (debug) console.error(`[nio:debug] env falhou (malformado?): ${path}`);
  }
}

const explicit = process.env.NIO_ENV_FILE?.trim();
if (explicit) tryLoad(explicit);
tryLoad(join(process.cwd(), '.env'));
tryLoad(join(homedir(), '.nio', 'config.env'));
