/**
 * Implementação Postgres do `SessionRepository` (port em `core/repositories.ts`).
 * Usa o Pool único de `./client`. A regra de negócio central — **1 sessão ativa
 * por usuário** — é aplicada atomicamente (`withTransaction`) em `create` e
 * `activate`: a sessão alvo vira `active` e as demais ativas do usuário caem pra
 * `archived`.
 */
import type { Session, SessionStatus, EnvironmentConfig } from '../../core/session.js';
import type { NewSessionInput, SessionRepository } from '../../core/repositories.js';
import { query, withTransaction } from './client.js';

/** Linha crua de `sessions` (snake_case), como o pg devolve. */
export interface SessionRow {
  id: string;
  user_id: string; // BIGINT vem como string no pg
  name: string;
  profile: string;
  status: string;
  project_path: string;
  ide: string;
  config: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

const COLS =
  'id, user_id, name, profile, status, project_path, ide, config, created_at, updated_at';

/** Mapeia a linha crua para a entidade de domínio. Parse tolerante do JSONB. */
export function mapSessionRow(row: SessionRow): Session {
  return {
    id: row.id,
    userId: Number(row.user_id),
    name: row.name,
    profile: row.profile as Session['profile'],
    status: row.status as SessionStatus,
    projectPath: row.project_path,
    ide: row.ide as Session['ide'],
    config: (row.config ?? {}) as EnvironmentConfig,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createSessionRepository(): SessionRepository {
  return {
    async create(input: NewSessionInput) {
      return withTransaction(async (tx) => {
        // Invariante 1-ativa-por-usuário: arquiva as ativas antes de inserir.
        await tx.query(
          `UPDATE sessions SET status = 'archived' WHERE user_id = $1 AND status = 'active'`,
          [input.userId],
        );
        const res = await tx.query<SessionRow>(
          `INSERT INTO sessions (user_id, name, profile, status, project_path, ide, config)
           VALUES ($1, $2, $3, 'active', $4, $5, $6)
           RETURNING ${COLS}`,
          [
            input.userId,
            input.name,
            input.profile,
            input.projectPath,
            input.ide,
            JSON.stringify(input.config ?? {}),
          ],
        );
        return mapSessionRow(res.rows[0]!);
      });
    },

    async findById(id) {
      const res = await query<SessionRow>(`SELECT ${COLS} FROM sessions WHERE id = $1`, [id]);
      const row = res.rows[0];
      return row ? mapSessionRow(row) : null;
    },

    async listByUser(userId) {
      const res = await query<SessionRow>(
        `SELECT ${COLS} FROM sessions WHERE user_id = $1 ORDER BY updated_at DESC`,
        [userId],
      );
      return res.rows.map(mapSessionRow);
    },

    async findActiveByUser(userId) {
      const res = await query<SessionRow>(
        `SELECT ${COLS} FROM sessions WHERE user_id = $1 AND status = 'active'
         ORDER BY updated_at DESC LIMIT 1`,
        [userId],
      );
      const row = res.rows[0];
      return row ? mapSessionRow(row) : null;
    },

    async activate(id, userId) {
      return withTransaction(async (tx) => {
        const found = await tx.query<SessionRow>(
          `UPDATE sessions SET status = 'active' WHERE id = $1 RETURNING ${COLS}`,
          [id],
        );
        if (!found.rows[0]) return null;
        await tx.query(
          `UPDATE sessions SET status = 'archived' WHERE user_id = $1 AND status = 'active' AND id <> $2`,
          [userId, id],
        );
        return mapSessionRow(found.rows[0]);
      });
    },

    async setStatus(id, status) {
      await query('UPDATE sessions SET status = $2 WHERE id = $1', [id, status]);
    },

    async updateConfig(id, config) {
      await query('UPDATE sessions SET config = $2 WHERE id = $1', [id, JSON.stringify(config)]);
    },

    async delete(id) {
      await query('DELETE FROM sessions WHERE id = $1', [id]);
    },
  };
}
