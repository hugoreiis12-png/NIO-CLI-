/**
 * Keyring de segredos de auth (ADR 0011). Centraliza a leitura de env com os
 * fallbacks backward-compatible. `core/` não importa daqui — é IO de env.
 *
 * Segredos, todos "mesmo valor em todo nó do gateway" (regra do `JWT_SECRET`):
 *  - `NIO_PEPPERS`  — CSV `id:segredo` (o de maior id é o atual). `NIO_PEPPER`
 *                     singular = açúcar pra `1:<valor>`. Ausente → sem pepper.
 *  - `OTP_HMAC_SECRET` — chave do HMAC do OTP. Ausente → cai no `JWT_SECRET`.
 *  - `JWT_SECRETS`  — CSV `kid:segredo` (a última entrada assina; qualquer uma
 *                     verifica). Ausente → assina/verifica com `JWT_SECRET` sem
 *                     `kid` (comportamento atual). Token legado (sem `kid`) sempre
 *                     verifica contra `JWT_SECRET`.
 *
 * PERDER o `NIO_PEPPERS` depois de usar = reset de senha forçado dos usuários
 * peppered. Trate como segredo crítico, com backup.
 */
import { getJwtSecret, MIN_JWT_SECRET_LENGTH } from '../../gateway/config.js';

/** id 0 = sem pepper (usuário legado, ou nenhum pepper configurado). */
export const NO_PEPPER = 0;

let cache: Map<number, Buffer> | null = null;

function parsePeppers(): Map<number, Buffer> {
  const map = new Map<number, Buffer>();
  const raw = process.env.NIO_PEPPERS?.trim() || envSinglePepper();
  if (!raw) return map;

  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const sep = trimmed.indexOf(':');
    const id = Number(sep >= 0 ? trimmed.slice(0, sep) : NaN);
    const secret = sep >= 0 ? trimmed.slice(sep + 1) : '';
    if (!Number.isInteger(id) || id <= 0 || !secret) {
      throw new Error(`NIO_PEPPERS inválido: entrada "${trimmed}" (esperado "id:segredo", id inteiro > 0).`);
    }
    if (secret.length < MIN_JWT_SECRET_LENGTH) {
      throw new Error(
        `NIO_PEPPERS: o pepper id ${id} tem ${secret.length} chars — mínimo ${MIN_JWT_SECRET_LENGTH}. ` +
          'Gere com `openssl rand -base64 32`.',
      );
    }
    map.set(id, Buffer.from(secret, 'utf8'));
  }
  return map;
}

/** `NIO_PEPPER` (singular) → `1:<valor>`, pra quem só tem um. */
function envSinglePepper(): string {
  const v = process.env.NIO_PEPPER?.trim();
  return v ? `1:${v}` : '';
}

function peppers(): Map<number, Buffer> {
  return (cache ??= parsePeppers());
}

/** Só pra teste — força re-parse na próxima chamada. */
export function __resetPeppers(): void {
  cache = null;
}

/** O pepper daquele `id`, ou `undefined` (id 0, ou id desconhecido). */
export function pepperFor(id: number): Buffer | undefined {
  return id === NO_PEPPER ? undefined : peppers().get(id);
}

/** Id do pepper atual (o de maior id), ou `NO_PEPPER` se nenhum configurado. */
export function currentPepperId(): number {
  let max = NO_PEPPER;
  for (const id of peppers().keys()) if (id > max) max = id;
  return max;
}

/** Chave do HMAC do OTP — própria (`OTP_HMAC_SECRET`) ou o `JWT_SECRET` (default). */
export function otpHmacSecret(): string {
  return process.env.OTP_HMAC_SECRET?.trim() || getJwtSecret();
}

// ─── JWT: rotação por `kid` (ADR 0011 §E) ───────────────────────────

const KID_RE = /^[A-Za-z0-9._-]{1,32}$/;
let jwtCache: Map<string, string> | null = null;

function parseJwtSecrets(): Map<string, string> {
  const map = new Map<string, string>();
  const raw = process.env.JWT_SECRETS?.trim();
  if (!raw) return map;

  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const sep = trimmed.indexOf(':');
    const kid = sep >= 0 ? trimmed.slice(0, sep).trim() : '';
    const secret = sep >= 0 ? trimmed.slice(sep + 1) : '';
    if (!kid || !secret) {
      throw new Error(`JWT_SECRETS inválido: entrada "${trimmed}" (esperado "kid:segredo").`);
    }
    if (!KID_RE.test(kid)) {
      throw new Error(`JWT_SECRETS: kid "${kid}" inválido (use [A-Za-z0-9._-], até 32 chars).`);
    }
    if (secret.length < MIN_JWT_SECRET_LENGTH) {
      throw new Error(
        `JWT_SECRETS: o segredo do kid "${kid}" tem ${secret.length} chars — mínimo ${MIN_JWT_SECRET_LENGTH}.`,
      );
    }
    map.set(kid, secret);
  }
  return map;
}

function jwtSecrets(): Map<string, string> {
  return (jwtCache ??= parseJwtSecrets());
}

/** Só pra teste. */
export function __resetJwtSecrets(): void {
  jwtCache = null;
}

/**
 * Chave pra **assinar** um JWT novo. Com `JWT_SECRETS`: a última entrada (a mais
 * nova). Senão: `JWT_SECRET`, sem `kid`.
 */
export function jwtSigningKey(): { kid: string | undefined; secret: string } {
  const m = jwtSecrets();
  if (m.size > 0) {
    const last = [...m.entries()].at(-1)!;
    return { kid: last[0], secret: last[1] };
  }
  return { kid: undefined, secret: getJwtSecret() };
}

/**
 * Chave pra **verificar** um JWT. `kid` = o do header do token (`undefined` =
 * token legado, sem `kid`). `null` = `kid` não reconhecido → token inválido.
 */
export function jwtVerifyKey(kid: string | undefined): string | null {
  if (kid) return jwtSecrets().get(kid) ?? null;
  return process.env.JWT_SECRET?.trim() || null;
}
