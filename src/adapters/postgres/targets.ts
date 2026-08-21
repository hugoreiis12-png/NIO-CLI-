import { env, envName } from '../../brand.js';
import type { DbTarget } from '../../core/types.js';

/** Metadados fixos de um destino de banco (host/porta são LAN, não são segredo). */
export interface DbTargetInfo {
  /** IP do banco na rede interna. */
  host: string;
  /** Porta do Postgres. */
  port: number;
  /** Rótulo humano p/ logs e mensagens de erro (observabilidade — F16). */
  label: string;
  /** Sufixo da env var que carrega o DSN completo (com credenciais). */
  envKey: string;
}

/**
 * Os dois destinos read-only dual-IP (P01 do roadmap). Host/porta ficam no
 * código (referência estável, não são segredo); o DSN completo — usuário,
 * senha e database — vem SEMPRE do ambiente (`resolveDsn`), nunca é chumbado
 * aqui (regra P0-T2 do plano: credencial real não entra no repo).
 */
export const DB_TARGETS: Record<DbTarget, DbTargetInfo> = {
  primary: { host: '192.168.0.142', port: 5432, label: 'banco novo', envKey: 'DB_PRIMARY_URL' },
  secondary: { host: '192.168.0.250', port: 5432, label: 'banco antigo', envKey: 'DB_SECONDARY_URL' },
};

/** Sufixo da env var do store de users (read-write) — separado dos alvos read-only. */
export const USERS_DB_ENV_KEY = 'DB_USERS_URL';

/**
 * DSN do destino read-only, lido do ambiente. **Throw explícito** se ausente —
 * nunca cai num destino default (Invariante #4). A mensagem já diz qual env
 * definir e a qual banco ela aponta.
 */
export function resolveDsn(target: DbTarget): string {
  const info = DB_TARGETS[target];
  const dsn = env(info.envKey)?.trim();
  if (!dsn) {
    throw new Error(
      `Destino "${target}" (${info.label}, ${info.host}:${info.port}) não configurado: ` +
        `defina a env var ${envName(info.envKey)} com o DSN do Postgres.`,
    );
  }
  return dsn;
}

/**
 * DSN do store de users (read-write). Único caminho de escrita do backend
 * Postgres — o cadastro de usuários vive aqui, separado dos alvos de
 * investigação read-only. **Throw explícito** se ausente.
 */
export function resolveUsersDsn(): string {
  const dsn = env(USERS_DB_ENV_KEY)?.trim();
  if (!dsn) {
    throw new Error(
      `Store de users não configurado: defina a env var ${envName(USERS_DB_ENV_KEY)} ` +
        `com o DSN do banco de cadastro (read-write).`,
    );
  }
  return dsn;
}