/**
 * Implementação Postgres do `UserRepository` (port em `core/repositories.ts`).
 * Usa o Pool único de `./client` e o hashing argon2id de `lib/auth/password`.
 *
 * Segurança: `password` e `backup_codes` (hashes) nunca saem daqui nas entidades
 * — `UserCli` não os carrega; `getBackupCodes` é a única porta pros de backup.
 * `verifyCredentials` não distingue nome/senha errados nem por mensagem nem por
 * **tempo** (roda um argon2 decoy quando o usuário não existe — auditoria M-5) e
 * re-hasheia a senha quando os params/pepper mudam (ADR 0011 §B).
 *
 * **Privilégio (TP-1 / migration 0008):** `findByName`/`findById` só selecionam
 * `PUBLIC_COLS` (sem `password`/`backup_codes`), porque o role `nio_cli` (CLI +
 * MCP) só tem `SELECT` dessas colunas. `verifyCredentials`, `create` e o resto
 * rodam só no gateway (role `nio_gateway`).
 */
import { randomBytes } from 'node:crypto';
import type { UserCli } from '../../core/types.js';
import type { NewUserInput, UserRepository } from '../../core/repositories.js';
import { hashPassword, needsRehash, verifyPassword, MIN_PASSWORD_LENGTH } from '../../lib/auth/password.js';
import { query } from './client.js';

/**
 * Hash decoy pro caminho "usuário não existe" — computado 1× com os params
 * atuais, então o `verifyPassword` contra ele gasta o mesmo tempo de um usuário
 * real. Lazy: só a 1ª tentativa de enumeração paga a criação.
 */
let decoyHashPromise: Promise<string> | null = null;
function decoyHash(): Promise<string> {
  return (decoyHashPromise ??= hashPassword(`decoy-${randomBytes(16).toString('hex')}`).then((h) => h.phc));
}

/** Colunas de `user_cli` visíveis pro role `nio_cli` — **sem** os hashes. */
interface UserRow {
  id: string; // BIGSERIAL vem como string no pg
  name: string;
  password_pepper_id: number; // SMALLINT — 0 = sem pepper
  timestamp_creation: Date;
  timestamp_password_change: Date | null;
  auth_2: boolean;
  phone: string | null;
  backup_pepper_id: number;
  timestamp_last_session: Date | null;
  ips_using: string | null;
}

/** `UserRow` + os hashes — só o gateway (`nio_gateway`) enxerga. */
interface FullUserRow extends UserRow {
  password: string;
  backup_codes: string | null;
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

/** Sem hashes — o que o role `nio_cli` pode ler. */
const PUBLIC_COLS =
  'id, name, password_pepper_id, timestamp_creation, timestamp_password_change, ' +
  'auth_2, phone, backup_pepper_id, timestamp_last_session, ips_using';
/** + os hashes — só o gateway. */
const FULL_COLS = `${PUBLIC_COLS}, password, backup_codes`;

export function createUserRepository(): UserRepository {
  return {
    async findByName(name) {
      const res = await query<UserRow>(`SELECT ${PUBLIC_COLS} FROM user_cli WHERE name = $1`, [name]);
      const row = res.rows[0];
      return row ? mapUserRow(row) : null;
    },

    async findById(id) {
      const res = await query<UserRow>(`SELECT ${PUBLIC_COLS} FROM user_cli WHERE id = $1`, [id]);
      const row = res.rows[0];
      return row ? mapUserRow(row) : null;
    },

    async create(input: NewUserInput) {
      // Enforce server-side — o `nio register` já valida, mas o contrato é do adapter.
      if (input.password.length < MIN_PASSWORD_LENGTH) {
        throw new Error(`Senha muito curta (mínimo ${MIN_PASSWORD_LENGTH} caracteres).`);
      }
      const { phc, pepperId } = await hashPassword(input.password);
      const res = await query<UserRow>(
        `INSERT INTO user_cli (name, password, password_pepper_id) VALUES ($1, $2, $3) RETURNING ${PUBLIC_COLS}`,
        [input.name, phc, pepperId],
      );
      return mapUserRow(res.rows[0]!);
    },

    async verifyCredentials(name, password) {
      const res = await query<FullUserRow>(`SELECT ${FULL_COLS} FROM user_cli WHERE name = $1`, [name]);
      const row = res.rows[0];
      if (!row) {
        await verifyPassword(await decoyHash(), password, 0); // queima o tempo do argon2
        return null;
      }
      const ok = await verifyPassword(row.password, password, row.password_pepper_id);
      if (!ok) return null;

      // Re-hash on login (ADR 0011 §B) — best-effort, não bloqueia o login.
      if (needsRehash(row.password, row.password_pepper_id)) {
        try {
          const fresh = await hashPassword(password);
          await query(
            'UPDATE user_cli SET password = $2, password_pepper_id = $3, timestamp_password_change = NOW() WHERE id = $1',
            [Number(row.id), fresh.phc, fresh.pepperId],
          );
        } catch {
          /* segue com o login mesmo se o re-hash falhar */
        }
      }
      return mapUserRow(row);
    },

    async touchLastSession(userId) {
      await query('UPDATE user_cli SET timestamp_last_session = NOW() WHERE id = $1', [userId]);
    },

    async updatePasswordHash(userId, phc, pepperId) {
      await query(
        'UPDATE user_cli SET password = $2, password_pepper_id = $3, timestamp_password_change = NOW() WHERE id = $1',
        [userId, phc, pepperId],
      );
    },

    async enable2fa(userId, phone, backupCodeHashes, backupPepperId) {
      await query(
        'UPDATE user_cli SET auth_2 = TRUE, phone = $2, backup_codes = $3, backup_pepper_id = $4 WHERE id = $1',
        [userId, phone, backupCodeHashes, backupPepperId],
      );
    },

    async disable2fa(userId) {
      await query(
        'UPDATE user_cli SET auth_2 = FALSE, phone = NULL, backup_codes = NULL, backup_pepper_id = 0 WHERE id = $1',
        [userId],
      );
    },

    async updateBackupCodes(userId, joined, pepperId) {
      await query('UPDATE user_cli SET backup_codes = $2, backup_pepper_id = $3 WHERE id = $1', [
        userId,
        joined,
        pepperId,
      ]);
    },

    async getBackupCodes(userId) {
      const res = await query<{ backup_codes: string | null; backup_pepper_id: number }>(
        'SELECT backup_codes, backup_pepper_id FROM user_cli WHERE id = $1',
        [userId],
      );
      const row = res.rows[0];
      return { codes: row?.backup_codes ?? null, pepperId: row?.backup_pepper_id ?? 0 };
    },
  };
}
