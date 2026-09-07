/**
 * Implementação Postgres do `LoginIpRepository` (port em `core/repositories.ts`)
 * — auditoria de IP de login (ADR 0011 §F). Só registro/consulta/retenção; nada
 * aqui bloqueia login.
 */
import type { LoginIpEvent, LoginIpRepository } from '../../core/repositories.js';
import { query } from './client.js';

interface Row {
  ip: string;
  first_seen: Date;
  last_seen: Date;
  count: string; // BIGINT vem como string no pg
}

const map = (r: Row): LoginIpEvent => ({
  ip: r.ip,
  firstSeen: r.first_seen,
  lastSeen: r.last_seen,
  count: Number(r.count),
});

export function createLoginIpRepository(): LoginIpRepository {
  return {
    async record(userId, ip) {
      await query(
        `INSERT INTO login_ip_events (user_id, ip) VALUES ($1, $2)
         ON CONFLICT (user_id, ip)
         DO UPDATE SET last_seen = NOW(), count = login_ip_events.count + 1`,
        [userId, ip],
      );
    },

    async recent(userId, limit = 10) {
      const res = await query<Row>(
        `SELECT host(ip) AS ip, first_seen, last_seen, count FROM login_ip_events
         WHERE user_id = $1 ORDER BY last_seen DESC LIMIT $2`,
        [userId, limit],
      );
      return res.rows.map(map);
    },

    async pruneOlderThan(days) {
      const res = await query(
        `DELETE FROM login_ip_events WHERE last_seen < NOW() - ($1 || ' days')::interval`,
        [days],
      );
      return res.rowCount ?? 0;
    },
  };
}
