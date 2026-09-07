/**
 * Implementação Postgres do `AuthEventRepository` (port em `core/repositories.ts`)
 * — trilha de auth persistente (ADR 0012). Só grava/consulta/retém; nada aqui
 * bloqueia login (o caller usa `.catch()`).
 */
import type {
  AuthEventInput,
  AuthEventRepository,
  AuthFailure,
} from '../../core/repositories.js';
import { query } from './client.js';

/** `name` é input do cliente — capa pra não encher a coluna com lixo. */
const NAME_MAX = 128;

/** Falhas que o `nio security status` mostra. */
const FAILURE_EVENTS = ['password_fail', '2fa_fail', '2fa_expired'];

export function createAuthEventRepository(): AuthEventRepository {
  return {
    async record(input: AuthEventInput) {
      await query(
        `INSERT INTO auth_events (event, name, user_id, ip, trace_id, detail)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          input.event,
          input.name ? input.name.slice(0, NAME_MAX) : null,
          input.userId ?? null,
          input.ip ?? null,
          input.traceId ?? null,
          input.detail ? JSON.stringify(input.detail) : null,
        ],
      );
    },

    async recentFailures({ userId, name, limit = 5 }) {
      // por user_id (usuário conhecido) OU por name (tentativa antes de existir).
      const res = await query<{ at: Date; event: string; ip: string | null }>(
        `SELECT at, event, host(ip) AS ip FROM auth_events
         WHERE event = ANY($1)
           AND ( ($2::bigint IS NOT NULL AND user_id = $2) OR ($3::text IS NOT NULL AND name = $3) )
         ORDER BY at DESC LIMIT $4`,
        [FAILURE_EVENTS, userId ?? null, name ?? null, limit],
      );
      return res.rows.map((r): AuthFailure => ({ at: r.at, event: r.event, ip: r.ip }));
    },

    async pruneOlderThan(days) {
      const res = await query(
        `DELETE FROM auth_events WHERE at < NOW() - ($1 || ' days')::interval`,
        [days],
      );
      return res.rowCount ?? 0;
    },
  };
}
