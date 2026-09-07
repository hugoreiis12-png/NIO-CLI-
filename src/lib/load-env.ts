/**
 * Carrega variáveis de `.env` nos binários (rodam sob `node`, que não lê `.env`
 * sozinho). Importe PRIMEIRO, antes de qualquer módulo que leia env no topo.
 *
 * Precedência: env do shell > `$NIO_ENV_FILE` > `.env` do diretório atual >
 * `~/.nio/config.env`. Nunca sobrescreve valor já presente no ambiente.
 *
 * SEGURANÇA (auditoria M-6): o `nio` roda dentro de repositórios de projeto
 * arbitrários. Um `.env` hostil na raiz de um repo clonado poderia injetar
 * `NIO_DATABASE_URL` (aponta o NIO pro banco do atacante), `NIO_SKILLS_REPO`
 * (→ execução de código), `SMS_*`, etc. Por isso o `.env` do **cwd** só carrega
 * um allowlist de chaves inócuas. Config sensível vem só do shell, do
 * `NIO_ENV_FILE` explícito, ou de `~/.nio/config.env` (o do próprio usuário).
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

const debug = /^(1|true|yes|on)$/i.test((process.env.NIO_DEBUG ?? '').trim());

/** Chaves que um `.env` de projeto (cwd) pode setar — nada de infra/segredo. */
const CWD_ALLOWLIST = new Set([
  'NIO_DEBUG',
  'NIO_NO_ANIM',
  'NIO_TELEMETRY',
  'NIO_NO_TELEMETRY',
]);

/** `process.loadEnvFile` (Node 20.12+) existe? Sob Bun / Node antigo, não. */
const nodeLoad = (process as { loadEnvFile?: (p: string) => void }).loadEnvFile;

/**
 * Parser mínimo `KEY=value`. Com `allow`, só aplica chaves do conjunto (o `.env`
 * do cwd). Sem `allow`, aplica tudo (fontes confiáveis).
 */
function parseAndApply(text: string, allow?: Set<string>): void {
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    if (allow && !allow.has(key)) {
      if (debug) console.error(`[nio:debug] env ignorada (fora do allowlist do cwd): ${key}`);
      continue;
    }
    if (process.env[key] === undefined) {
      process.env[key] = line.slice(eq + 1).trim();
    }
  }
}

function tryLoad(path: string, allow?: Set<string>): void {
  if (!existsSync(path)) {
    if (debug) console.error(`[nio:debug] env ausente: ${path}`);
    return;
  }
  try {
    // Com allowlist, sempre o parser manual (o `process.loadEnvFile` aplica tudo
    // direto no `process.env`, sem como filtrar depois).
    if (nodeLoad && !allow) nodeLoad(path);
    else parseAndApply(readFileSync(path, 'utf8'), allow);
    if (debug) console.error(`[nio:debug] env carregado: ${path}`);
  } catch (err) {
    if (debug) console.error(`[nio:debug] env falhou (${(err as Error).message}): ${path}`);
  }
}

const explicit = process.env.NIO_ENV_FILE?.trim();
if (explicit) tryLoad(explicit);
tryLoad(join(process.cwd(), '.env'), CWD_ALLOWLIST);
tryLoad(join(homedir(), '.nio', 'config.env'));

export { CWD_ALLOWLIST, parseAndApply };
