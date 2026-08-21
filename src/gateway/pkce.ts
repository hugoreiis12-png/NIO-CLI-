import { createHash, randomBytes } from 'node:crypto';

/** Base64url sem padding (RFC 7636 usa isto pro verifier/challenge). */
function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** `code_verifier` do cliente (CLI) — gerado antes de abrir o navegador. */
export function generateVerifier(): string {
  return base64url(randomBytes(32));
}

/** `code_challenge` = BASE64URL(SHA256(code_verifier)) — método S256, único suportado. */
export function challengeFromVerifier(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest());
}

/** `state` — CSRF/replay: o cliente gera, manda no `/authorize`, confere no callback. */
export function randomState(): string {
  return base64url(randomBytes(16));
}
