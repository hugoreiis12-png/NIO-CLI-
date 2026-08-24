import { randomUUID } from 'node:crypto';
import type { GatewayUser } from './types.js';

/**
 * Sessões em memória do processo — MVP, uso interno (spec 0002). Reiniciar o
 * processo derruba todo mundo; não é distribuído.
 */

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h

interface SessionRecord {
  token: string;
  user: GatewayUser;
  expiresAt: number;
}

const byToken = new Map<string, SessionRecord>();
const byUser = new Map<string, string>(); // userId -> token ativo

export function createSession(user: GatewayUser): { token: string; expiresIn: number } {
  const previous = byUser.get(user.id);
  if (previous) byToken.delete(previous);

  const token = randomUUID();
  const expiresAt = Date.now() + SESSION_TTL_MS;
  byToken.set(token, { token, user, expiresAt });
  byUser.set(user.id, token);
  return { token, expiresIn: SESSION_TTL_MS / 1000 };
}

/** `null` se o token não existe ou expirou (e limpa a entrada expirada). */
export function validateSession(token: string): GatewayUser | null {
  const record = byToken.get(token);
  if (!record) return null;
  if (record.expiresAt < Date.now()) {
    byToken.delete(token);
    byUser.delete(record.user.id);
    return null;
  }
  return record.user;
}

export function revokeSession(token: string): boolean {
  const record = byToken.get(token);
  if (!record) return false;
  byToken.delete(token);
  byUser.delete(record.user.id);
  return true;
}

/** Só pra teste/introspecção — não expor via HTTP. */
export function activeSessionCount(): number {
  return byToken.size;
}
