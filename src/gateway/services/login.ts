/**
 * Orquestra o login: credencial → auth_session → JWT (`jti = auth_session.id`).
 * Consome `UserRepository` (senha) e `AuthSessionRepository` (sessão de
 * login) — sem saber de HTTP, quem chama (rota do gateway, comando de CLI)
 * decide a superfície.
 */
import jwt from 'jsonwebtoken';
import { createUserRepository } from '../../adapters/pg/user-repository.js';
import { createAuthSessionRepository } from '../../adapters/pg/auth-session-repository.js';
import { getJwtSecret, JWT_EXPIRES_IN } from '../config.js';
 
export interface LoginResult {
    token: string;
    userId: number;
    name: string;
    sessionId: string; // = jti embutido no token 
    expiresAt: Date;

}

/** Converte '12h' | '30m' | '3600s' | '1d' em milissegundos. Throw se o formato não bater. */
export function expiresInMs(spec: string): number {
    const m =  /^(\d+)(s|m|h|d)$/.exec(spec.trim());
    if (!m) {
        throw new Error(`JWT_EXPIRES_IN inválido: "${spec}" (formato esperado: 12h, 30m, 3600s, 1d).`);
    }
    const unit = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000}[m[2] as 's'| 'm' | 'h' | 'd'];
    return Number(m[1]) * unit;
}

/** Verifica usuário, cria a áuth_session'e asisna o JWT. null se as credencias não conferem (anti-enumeração, herdado do 'UserRepository'). */
export async function login(name: string, password: string): Promise<LoginResult | null> {
    const users = createUserRepository();
    const user = await users.verifyCredentials(name, password);
    if (!user) return null;
    await users.touchLastSession(user.id);

    const authSessions = createAuthSessionRepository();
    const ms = expiresInMs(JWT_EXPIRES_IN);
    const expiresAt = new Date(Date.now() + ms);
    const session = await authSessions.create({ userId: user.id, expiresAt });

    // `expiresIn` como number (segundos) — `@types/jsonwebtoken` tipa a forma
    // string via `StringValue` (do pacote `ms`), que não aceita `string` genérico
    // vindo de env var. Reaproveita o `ms` já validado por `expiresInMs`.
    const token = jwt.sign(
        { sub: String(user.id), jti: session.id },
        getJwtSecret(),
        { algorithm: 'HS256', expiresIn: Math.floor(ms / 1000) },
    );
    return { token, userId: user.id, name: user.name, sessionId: session.id, expiresAt };
}
/** revoga a 'auth_session'(logout). Idempotente, não erro se já revogada. */
export async function logout(sessionId: string): Promise<void> {
    await createAuthSessionRepository().revoke(sessionId);
}
