/**
 * Implementação Postgres do `AuthSessionRepository` (port em
 * `core/repositories.ts`). Usa o Pool único de `./client`.
 *
 * Sem invariante de unicidade — ao contrário de `session-repository.ts`
 * (ambiente, 1-ativa-por-usuário), `create` aqui nunca toca em outras linhas
 * do mesmo usuário. É isso que viabiliza multi-dispositivo: cada login é uma
 * linha independente.
 */
import type { AuthSession } from '../../core/types.js';
import type { AuthSessionRepository, NewAuthSessionInput } from '../../core/repositories.js';
import { query, isUuid } from './client.js';

/** Linha crua de `auth_sessions` (snake_case), como o pg devolve. */
export interface AuthSessionRow {
  id: string;
  user_id: string; // BIGINT vem como string no pg
  expires_at: Date;
  revoked_at: Date | null;
  created_at: Date;
}

const COLS = 'id, user_id, expires_at, revoked_at, created_at';

/** Mapeia a linha crua para a entidade de domínio. */
export function mapAuthSessionRow(row: AuthSessionRow): AuthSession {
  return {
    id: row.id,
    userId: Number(row.user_id),
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  };
}

export function createAuthSessionRepository(): AuthSessionRepository {
  return {
    async create(input: NewAuthSessionInput) {
      const res = await query<AuthSessionRow>(
        `INSERT INTO auth_sessions (user_id, expires_at) VALUES ($1, $2) RETURNING ${COLS}`,
        [input.userId, input.expiresAt],
      );
      return mapAuthSessionRow(res.rows[0]!);
    },

    async findById(id) {
      if (!isUuid(id)) return null;
      const res = await query<AuthSessionRow>(`SELECT ${COLS} FROM auth_sessions WHERE id = $1`, [id]);
      const row = res.rows[0];
      return row ? mapAuthSessionRow(row) : null;
    },

    async revoke(id) {
      if (!isUuid(id)) return;
      await query(
        `UPDATE auth_sessions SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL`,
        [id],
      );
    },

    async listActiveByUser(userId) {
      const res = await query<AuthSessionRow>(
        `SELECT ${COLS} FROM auth_sessions
         WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
         ORDER BY created_at DESC`,
        [userId],
      );
      return res.rows.map(mapAuthSessionRow);
    },

    async revokeAllByUser(userId) {
      await query(
        `UPDATE auth_sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId],
      );
    },
  };
}
