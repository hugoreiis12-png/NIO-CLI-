/**
 * Valida um bearer JWT: assinatura + expiração primeiro (rapido, sem rede),
 * depois confere 'revoked_at'/ 'expires_at' no Postgres, pega revogação 
 * (logout) que o jwt sozinho não sabe. Sem framewrok HTTP: devolve um
 * resultado tipado rota HTTP ou hanlder MCP decidem como reagir a 'ok': false'.
 * 
 * 
 * Algoritimo travado em HS256 nas duas pontas (sign e verify) - mitigação 
 * padrão contra ataque de confusão de algoitimo (RFC 9700/OWASP).
 */
import jwt from 'jsonwebtoken';
import { createAuthSessionRepository } from '../../adapters/pg/auth-session-repository.js';
import { JWT_ISSUER, JWT_AUDIENCE } from '../config.js';
import { jwtVerifyKey } from '../../lib/auth/secrets.js';

export type AuthResult =
    | { ok: true; userId: number; sessionId: string }
    | { ok: false; reason: 'token_ausente'| 'token_invalido' | 'sessao_revogada' | 'sessao_expirada' };

    /** Extrai o token de Authorization: Bearer <token>. null se ausente/mal formado. */
    export function extractBearerToken(authHeader: string |  undefined | null): string | null {
        if (!authHeader) return null;
        const m =  /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return m ? m[1]! : null;
}
/** Valida se o JWT e confere a auth_session no  banco.  Nunca lança, sempre devolve AuthResult.  */ 
export async function authenticate(authHeader: string | undefined | null): Promise<AuthResult> {
      const token = extractBearerToken(authHeader);
      if (!token) return { ok: false, reason: 'token_ausente' };

      let decoded: unknown;
      try{
        // resolve a chave pelo `kid` do header (ADR 0011 §E) — rotação de JWT.
        const header = jwt.decode(token, { complete: true })?.header;
        const secret = jwtVerifyKey(header?.kid);
        if (!secret) return { ok: false, reason: 'token_invalido' };
        decoded = jwt.verify(token, secret, {
          algorithms: ['HS256'],
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
        })
      } catch {
        return { ok: false, reason: 'token_invalido' };
      }

      if (!decoded || typeof decoded !== 'object'|| typeof (decoded as Record<string, unknown>).jti !== 'string') {
        return { ok: false, reason: 'token_invalido'};
      }
      const { jti, sub } = decoded as { jti: string; sub?: unknown };

      const session = await createAuthSessionRepository().findById(jti);
      if (!session) return { ok: false, reason: 'token_invalido' };
      if (session.revokedAt) return { ok: false,  reason: 'sessao_revogada' };
      if (session.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'sessao_expirada' };
      // defesa em profundidade: o `sub` do token tem que bater com o dono da
      // auth_session (a fonte da verdade). Um token com jti válido mas sub trocado
      // não passa.
      if (typeof sub === 'string' && sub !== String(session.userId)) {
        return { ok: false, reason: 'token_invalido' };
      }

      return { ok: true , userId: session.userId, sessionId: session.id };

      }
