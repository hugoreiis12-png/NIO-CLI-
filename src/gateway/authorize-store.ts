import { randomUUID } from 'node:crypto';

/**
 * Códigos de autorização pendentes — em memória, de uso único, curtos (5min).
 * Ponte entre o `/authorize` (onde o code nasce) e o `/token` (onde é trocado).
 */

const CODE_TTL_MS = 5 * 60 * 1000;

interface PendingAuthorization {
  codeChallenge: string;
  redirectUri: string;
  email: string;
  expiresAt: number;
}

const byCode = new Map<string, PendingAuthorization>();

// Criação do codigo de autorização (PKCE) - usado no endpoint /authorize para gerar o codigo de autorização que será trocado 
export function createAuthorizationCode(input: {
  codeChallenge: string;
  redirectUri: string;
  email: string;
}): string {
  const code = randomUUID();
  byCode.set(code, { ...input, expiresAt: Date.now() + CODE_TTL_MS });
  return code;
}

/** Uso único: consome o code mesmo se a verificação de PKCE falhar depois. */
export function consumeAuthorizationCode(code: string): PendingAuthorization | null {
  const entry = byCode.get(code);
  if (!entry) return null;
  byCode.delete(code);
  return entry.expiresAt >= Date.now() ? entry : null;
}
