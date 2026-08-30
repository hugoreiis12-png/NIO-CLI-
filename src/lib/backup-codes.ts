/**
 * Códigos de backup do 2º fator — 10 de uso único, mostrados 1× no `enable-2fa`,
 * a alternativa ao SMS exigida por NIST SP 800-63B. Hash argon2id (reusa
 * `lib/password`), juntos por `|` em `user_cli.backup_codes`; usado → `[USED]`.
 */
import { randomInt } from 'node:crypto';
import { hashPassword, verifyPassword } from './password.js';

const COUNT = 10;
const LENGTH = 8;
/** Sem 0/O, 1/I/L — evita confusão ao digitar. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const USED = '[USED]';

function randomCode(): string {
  let out = '';
  for (let i = 0; i < LENGTH; i++) out += ALPHABET[randomInt(0, ALPHABET.length)];
  return out;
}

/** 10 códigos novos + a string de hashes pronta pro banco (`hash|hash|…`). */
export async function generateBackupCodes(): Promise<{ codes: string[]; hashes: string }> {
  const codes = Array.from({ length: COUNT }, randomCode);
  const hashes = await Promise.all(codes.map((c) => hashPassword(c)));
  return { codes, hashes: hashes.join('|') };
}

/**
 * Confere um código digitado contra os hashes armazenados. Retorna o índice
 * (0-based) do código usado, ou `-1` se inválido / já usado. Case-insensitive.
 */
export async function verifyBackupCode(input: string, joined: string | null): Promise<number> {
  if (!joined) return -1;
  const normalized = input.trim().toUpperCase();
  const parts = joined.split('|');
  for (let i = 0; i < parts.length; i++) {
    const h = parts[i];
    if (!h || h === USED) continue;
    if (await verifyPassword(h, normalized)) return i;
  }
  return -1;
}

/** Marca a posição `idx` como usada. Retorna a nova string pro banco. */
export function markUsed(joined: string, idx: number): string {
  const parts = joined.split('|');
  if (idx >= 0 && idx < parts.length) parts[idx] = USED;
  return parts.join('|');
}

/** Quantos códigos de backup ainda valem. */
export function countRemaining(joined: string | null): number {
  if (!joined) return 0;
  return joined.split('|').filter((h) => h && h !== USED).length;
}

/** Formato aceito de código de backup (8 chars alfanuméricos). */
export function isBackupCodeFormat(s: string): boolean {
  return /^[A-Za-z0-9]{8}$/.test(s.trim());
}
