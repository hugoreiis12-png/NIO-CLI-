/**
 * Implementação Postgres do `UserRepository` (port em `core/repositories.ts`).
 * Usa o Pool único de `./client` e o hashing argon2id de `lib/password`.
 *
 * Segurança: o hash de senha (`password`) nunca sai deste arquivo — as entidades
 * `UserCli` retornadas não têm o campo. `verifyCredentials` não distingue
 * "nome inexistente" de "senha errada" (anti-enumeração).
 */
import type { UserCli } from '../../core/session.js';
import type { NewUserInput, UserRepository } from '../../core/repositories.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { query } from './client.js';

/** Colunas cruas de `user_cli` (snake_case) — inclui o hash, uso interno só. */
interface UserRow {
  id: string; // BIGSERIAL vem como string no pg
  name: string;
  password: string;
  timestamp_creation: Date;
  timestamp_password_change: Date | null;
  auth_2: boolean;
  timestamp_last_session: Date | null;
  ips_using: string | null;
}

/** Faz o parse tolerante do `ips_using` (TEXT com JSON array). `[]` se ilegível. */
function parseIps(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Mapeia a linha crua para a entidade de domínio, **descartando o hash de senha**. */
export function mapUserRow(row: UserRow): UserCli {
  return {
    id: Number(row.id),
    name: row.name,
    auth2: row.auth_2,
    ipsUsing: parseIps(row.ips_using),
    timestampCreation: row.timestamp_creation,
    timestampPasswordChange: row.timestamp_password_change,
    timestampLastSession: row.timestamp_last_session,
  };
}

const COLS =
  'id, name, password, timestamp_creation, ' +
  'timestamp_password_change, auth_2, timestamp_last_session, ips_using';

export function createUserRepository(): UserRepository {
  return {
    async findByName(name) {
      const res = await query<UserRow>(`SELECT ${COLS} FROM user_cli WHERE name = $1`, [name]);
      const row = res.rows[0];
      return row ? mapUserRow(row) : null;
    },

    async create(input: NewUserInput) {
      const passwordHash = await hashPassword(input.password);
      const res = await query<UserRow>(
        `INSERT INTO user_cli (name, password) VALUES ($1, $2) RETURNING ${COLS}`,
        [input.name, passwordHash],
      );
      return mapUserRow(res.rows[0]!);
    },

    async verifyCredentials(name, password) {
      const res = await query<UserRow>(`SELECT ${COLS} FROM user_cli WHERE name = $1`, [name]);
      const row = res.rows[0];
      if (!row) return null;
      const ok = await verifyPassword(row.password, password);
      return ok ? mapUserRow(row) : null;
    },

    async touchLastSession(userId) {
      await query('UPDATE user_cli SET timestamp_last_session = NOW() WHERE id = $1', [userId]);
    },
  };
}
