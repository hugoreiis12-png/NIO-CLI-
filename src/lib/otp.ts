/**
 * OTP de 6 dígitos do 2º fator (SMS). Geração + hash HMAC-SHA256 com o
 * `JWT_SECRET` (nunca persiste o código puro — constraint spec 0003/ANPD; HMAC
 * basta pra código de vida curta e rate-limitado). Ver spec 0004.
 */
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { getJwtSecret } from '../gateway/config.js';

/** Código numérico de 6 dígitos (com zeros à esquerda). */
export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** `HMAC-SHA256(code, secret)` em hex. `secret` default = `JWT_SECRET`. */
export function hashOtp(code: string, secret: string = getJwtSecret()): string {
  return createHmac('sha256', secret).update(code).digest('hex');
}

/** Confere um código contra o hash, em tempo constante. */
export function verifyOtp(code: string, hash: string, secret?: string): boolean {
  const expected = Buffer.from(hashOtp(code, secret ?? getJwtSecret()), 'hex');
  let actual: Buffer;
  try {
    actual = Buffer.from(hash, 'hex');
  } catch {
    return false;
  }
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Formato de OTP: exatamente 6 dígitos. */
export function isOtpFormat(s: string): boolean {
  return /^\d{6}$/.test(s.trim());
}
