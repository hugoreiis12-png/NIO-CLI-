/**
 * Ports de persistência do domínio v2 — interfaces que os adapters de banco
 * (`adapters/pg/*-repository.ts`) implementam. Sem import de driver aqui: é o
 * contrato, não a implementação.
 *
 * Contrato de erro: métodos de leitura por chave retornam `null` quando não acham
 * (não lançam); falha de infra (conexão, SQL inválido) propaga como throw.
 */
import type { UserCli, Session, Profile, SessionStatus, Ide, EnvironmentConfig, AuthSession } from './session.js';

/** Dados para criar um usuário. `password` é texto puro — o adapter hasheia (argon2id). */
export interface NewUserInput {
  name: string;
  password: string;
}

export interface UserRepository {
  /** Busca um usuário pelo nome único. `null` se não existir. */
  findByName(name: string): Promise<UserCli | null>;

  /** Cria um usuário (senha hasheada com argon2id antes de persistir). */
  create(input: NewUserInput): Promise<UserCli>;

  /**
   * Confere as credenciais. Retorna o usuário (sem hash) se a senha bate;
   * `null` se o nome não existe OU a senha não confere — sem distinguir os dois
   * casos para o chamador (evita enumeração de usuários).
   */
  verifyCredentials(name: string, password: string): Promise<UserCli | null>;

  /** Grava (ou limpa, com `null`) o token de sessão do usuário. */
  setSessionToken(userId: number, token: string | null): Promise<void>;

  /** Marca `timestamp_last_session = now()`. */
  touchLastSession(userId: number): Promise<void>;
}

/** Dados para criar uma sessão de ambiente. `status` nasce sempre `active`. */
export interface NewSessionInput {
  userId: number;
  name: string;
  profile: Profile;
  projectPath: string;
  ide: Ide;
  config?: EnvironmentConfig;
}

export interface SessionRepository {
  /**
   * Cria a sessão como `active` e arquiva as outras ativas do mesmo usuário
   * (invariante: **1 sessão ativa por usuário**) — atomicamente.
   */
  create(input: NewSessionInput): Promise<Session>;

  /** Busca por UUID. `null` se não existe (de outro usuário ou apagada). */
  findById(id: string): Promise<Session | null>;

  /** Todas as sessões do usuário, mais recentes primeiro (`updated_at DESC`). */
  listByUser(userId: number): Promise<Session[]>;

  /** A sessão ativa do usuário, se houver. */
  findActiveByUser(userId: number): Promise<Session | null>;

  /** Ativa a sessão (de qualquer status) e arquiva as demais ativas do usuário — atômico. */
  activate(id: string, userId: number): Promise<Session | null>;

  /** Muda o status (pause/archive). Sem regra de unicidade aqui. */
  setStatus(id: string, status: SessionStatus): Promise<void>;

  /** Substitui o `config` JSONB da sessão. */
  updateConfig(id: string, config: EnvironmentConfig): Promise<void>;

  /** Remove a sessão (logs/atividades/dependency_events caem por CASCADE). */
  delete(id: string): Promise<void>;
}

/** Dados para criar uma sessão de autenticação (login). `expiresAt` casa com o `exp` do JWT. */
export interface NewAuthSessionInput {
  userId: number;
  expiresAt: Date;
}

/**
 * Sessões de login (JWT) — porta separada de `SessionRepository` (ambiente).
 * Sem invariante de unicidade: `create` nunca afeta outras sessões do mesmo
 * usuário (é isso que viabiliza multi-dispositivo).
 */
export interface AuthSessionRepository {
  /** Cria uma sessão de login nova; independente de quaisquer outras do usuário. */
  create(input: NewAuthSessionInput): Promise<AuthSession>;

  /** Busca por id (= `jti` do JWT). `null` se não existe. */
  findById(id: string): Promise<AuthSession | null>;

  /** Revoga (logout). Idempotente — não erro se já revogada ou inexistente. */
  revoke(id: string): Promise<void>;

  /** Sessões ativas (não revogadas, não expiradas) do usuário — ex.: listar dispositivos logados. */
  listActiveByUser(userId: number): Promise<AuthSession[]>;

  /** Revoga todas as sessões ativas do usuário (ex.: "sair de todos os dispositivos"). */
  revokeAllByUser(userId: number): Promise<void>;
}
