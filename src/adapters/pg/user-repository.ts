/**
 * Implementação Postgres do `UserRepository` (port em `core/repositories.ts`).
 * Usa o Pool único de `./client` e o hashing argon2id de `lib/auth/password`.
 *
 * Segurança: `password` e `backup_codes` (hashes) nunca saem daqui nas entidades
 * — `UserCli` não os carrega; `getBackupCodes` é a única porta pros de backup.
 * `verifyCredentials` não distingue nome/senha errados (anti-enumeração).
 */
import type { UserCli } from '../../core/types.js';
import type { NewUserInput, UserRepository } from '../../core/repositories.js';
import { hashPassword, verifyPassword } from '../../lib/auth/password.js';
import { query } from './client.js';

/** Colunas cruas de `user_cli` (snake_case) — inclui hashes, uso interno só. */
interface UserRow {
  id: string; // BIGSERIAL vem como string no pg
  name: string;
  password: string;
  timestamp_creation: Date;
  timestamp_password_change: Date | null;
  auth_2: boolean;
  phone: string | null;
  backup_codes: string | null;
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

/** Mapeia a linha crua para a entidade de domínio, **descartando os hashes**. */
export function mapUserRow(row: UserRow): UserCli {
  return {
    id: Number(row.id),
    name: row.name,
    auth2: row.auth_2,
    phone: row.phone,
    ipsUsing: parseIps(row.ips_using),
    timestampCreation: row.timestamp_creation,
    timestampPasswordChange: row.timestamp_password_change,
    timestampLastSession: row.timestamp_last_session,
  };
}

const COLS =
  'id, name, password, timestamp_creation, timestamp_password_change, ' +
  'auth_2, phone, backup_codes, timestamp_last_session, ips_using';

export function createUserRepository(): UserRepository {
  return {
    async findByName(name) {
      const res = await query<UserRow>(`SELECT ${COLS} FROM user_cli WHERE name = $1`, [name]);
      const row = res.rows[0];
      return row ? mapUserRow(row) : null;
    },

    async findById(id) {
      const res = await query<UserRow>(`SELECT ${COLS} FROM user_cli WHERE id = $1`, [id]);
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

    async enable2fa(userId, phone, backupCodeHashes) {
      await query(
        'UPDATE user_cli SET auth_2 = TRUE, phone = $2, backup_codes = $3 WHERE id = $1',
        [userId, phone, backupCodeHashes],
      );
    },

    async disable2fa(userId) {
      await query(
        'UPDATE user_cli SET auth_2 = FALSE, phone = NULL, backup_codes = NULL WHERE id = $1',
        [userId],
      );
    },

    async updateBackupCodes(userId, joined) {
      await query('UPDATE user_cli SET backup_codes = $2 WHERE id = $1', [userId, joined]);
    },

    async getBackupCodes(userId) {
      const res = await query<{ backup_codes: string | null }>(
        'SELECT backup_codes FROM user_cli WHERE id = $1',
        [userId],
      );
      return res.rows[0]?.backup_codes ?? null;
    },
  };
}
