/**
 * Postgres do `LoginChallengeRepository` — estado do OTP do 2º fator na tabela
 * `login_challenges` (código hasheado, TTL, tentativas, consumo). `create` roda
 * em transação: apaga desafios ativos anteriores e expirados, depois insere.
 */
import type { LoginChallenge, ChallengePurpose } from '../../core/types.js';
import type {
  LoginChallengeRepository,
  NewLoginChallengeInput,
} from '../../core/repositories.js';
import { query, withTransaction, isUuid } from './client.js';

/** Linha crua de `login_challenges` (snake_case). */
export interface LoginChallengeRow {
  id: string;
  user_id: string; // BIGINT vem como string no pg
  purpose: string;
  code_hash: string;
  channel: string;
  attempts: number;
  expires_at: Date;
  consumed_at: Date | null;
  created_at: Date;
}

const COLS =
  'id, user_id, purpose, code_hash, channel, attempts, expires_at, consumed_at, created_at';

/** `id` da coluna é UUID — string fora do formato nunca casa (evita o erro 22P02 do pg). */
export function isChallengeId(id: string): boolean {
  return isUuid(id);
}

export function mapLoginChallengeRow(row: LoginChallengeRow): LoginChallenge {
  return {
    id: row.id,
    userId: Number(row.user_id),
    purpose: row.purpose as ChallengePurpose,
    codeHash: row.code_hash,
    channel: row.channel as 'sms',
    attempts: Number(row.attempts),
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    createdAt: row.created_at,
  };
}

export function createLoginChallengeRepository(): LoginChallengeRepository {
  return {
    async create(input: NewLoginChallengeInput) {
      return withTransaction(async (tx) => {
        await tx.query('DELETE FROM login_challenges WHERE expires_at < NOW()');
        await tx.query(
          'DELETE FROM login_challenges WHERE user_id = $1 AND consumed_at IS NULL',
          [input.userId],
        );
        const res = await tx.query<LoginChallengeRow>(
          `INSERT INTO login_challenges (user_id, purpose, code_hash, channel, expires_at)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING ${COLS}`,
          [input.userId, input.purpose, input.codeHash, input.channel, input.expiresAt],
        );
        return mapLoginChallengeRow(res.rows[0]!);
      });
    },

    async findById(id) {
      if (!isChallengeId(id)) return null;
      const res = await query<LoginChallengeRow>(
        `SELECT ${COLS} FROM login_challenges WHERE id = $1`,
        [id],
      );
      const row = res.rows[0];
      return row ? mapLoginChallengeRow(row) : null;
    },

    async incrementAttempts(id) {
      if (!isChallengeId(id)) return 0;
      const res = await query<{ attempts: number }>(
        'UPDATE login_challenges SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts',
        [id],
      );
      return Number(res.rows[0]?.attempts ?? 0);
    },

    async consume(id) {
      if (!isChallengeId(id)) return;
      await query(
        'UPDATE login_challenges SET consumed_at = NOW() WHERE id = $1 AND consumed_at IS NULL',
        [id],
      );
    },

    async deleteExpired() {
      await query('DELETE FROM login_challenges WHERE expires_at < NOW()');
    },
  };
}
