/**
 * Ports de persistência do domínio v2 — interfaces que os adapters de banco
 * (`adapters/pg/*-repository.ts`) implementam. Sem import de driver aqui: é o
 * contrato, não a implementação.
 *
 * Contrato de erro: métodos de leitura por chave retornam `null` quando não acham
 * (não lançam); falha de infra (conexão, SQL inválido) propaga como throw.
 */
import type {
  UserCli,
  Session,
  Profile,
  SessionStatus,
  Ide,
  EnvironmentConfig,
  AuthSession,
  DependencyEvent,
  DependencyType,
  LoginChallenge,
  ChallengePurpose,
} from './types.js';

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

  /** Busca por id. `null` se não existe. */
  findById(id: number): Promise<UserCli | null>;

  /** Marca `timestamp_last_session = now()`. */
  touchLastSession(userId: number): Promise<void>;

  /**
   * Re-grava o hash da senha (re-hash on login — ADR 0011 §B). `pepperId` = o
   * pepper usado no novo hash. Best-effort no caller (não bloqueia o login).
   */
  updatePasswordHash(userId: number, phc: string, pepperId: number): Promise<void>;

  /** Liga o 2º fator: `auth_2 = true`, grava `phone` (E.164), os hashes dos códigos de backup e o pepper usado. */
  enable2fa(userId: number, phone: string, backupCodeHashes: string, backupPepperId: number): Promise<void>;

  /** Desliga o 2º fator: `auth_2 = false`, limpa `phone` e `backup_codes`. */
  disable2fa(userId: number): Promise<void>;

  /** Substitui `backup_codes` (após usar um, ou regenerar) + o pepper usado. */
  updateBackupCodes(userId: number, joined: string, pepperId: number): Promise<void>;

  /** Hashes dos códigos de backup (`hash|hash|[USED]|…`) + o pepper usado. Só o gateway usa. */
  getBackupCodes(userId: number): Promise<{ codes: string | null; pepperId: number }>;
}

/** Dados para criar um desafio de OTP. `codeHash` é HMAC — nunca o código puro. */
export interface NewLoginChallengeInput {
  userId: number;
  purpose: ChallengePurpose;
  codeHash: string;
  channel: 'sms';
  expiresAt: Date;
}

/**
 * Desafios de OTP do 2º fator. `create` apaga os desafios ativos anteriores do
 * usuário (1 por vez) e os expirados. `findById`/`consume` são uso único.
 */
export interface LoginChallengeRepository {
  create(input: NewLoginChallengeInput): Promise<LoginChallenge>;
  /** `null` se não existe. Não filtra por consumido/expirado — o serviço decide. */
  findById(id: string): Promise<LoginChallenge | null>;
  /** `attempts = attempts + 1`, retorna o novo valor. */
  incrementAttempts(id: string): Promise<number>;
  /** `consumed_at = NOW()` — uso único. Idempotente. */
  consume(id: string): Promise<void>;
  /** Apaga os `expires_at < NOW()`. Best-effort de limpeza (sem cron). */
  deleteExpired(): Promise<void>;
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

/** Dados para registrar um evento de dependência detectada pelo watcher. */
export interface NewDependencyEventInput {
  sessionId: string;
  filePath: string;
  dependencyName: string;
  dependencyType: DependencyType;
}

/**
 * Eventos de dependência (`dependency_events`) detectados pelo watcher.
 * `recordIfNew` é a chave da idempotência: o watcher roda a cada 10s e re-detecta
 * as mesmas deps — só a PRIMEIRA vez vira evento novo (por session+file+name),
 * senão a tabela encheria de duplicatas.
 */
/** Uma linha de `login_ip_events` (auditoria de IP — ADR 0011 §F). */
export interface LoginIpEvent {
  ip: string;
  firstSeen: Date;
  lastSeen: Date;
  count: number;
}

export interface LoginIpRepository {
  /** Upsert: registra (ou incrementa) um login de `userId` a partir de `ip`. Best-effort — nunca deve bloquear o login. */
  record(userId: number, ip: string): Promise<void>;

  /** IPs mais recentes de `userId` (default 10), `lastSeen` desc. */
  recent(userId: number, limit?: number): Promise<LoginIpEvent[]>;

  /** Apaga eventos com `last_seen` mais velho que `days` (retenção). Devolve quantos. */
  pruneOlderThan(days: number): Promise<number>;
}

/** Entrada da trilha de auth (`auth_events` — ADR 0012). */
export interface AuthEventInput {
  event: string;
  name?: string | null;
  userId?: number | null;
  ip?: string | null;
  traceId?: string | null;
  detail?: Record<string, unknown> | null;
}

/** Uma falha da trilha, pro `nio security status`. */
export interface AuthFailure {
  at: Date;
  event: string;
  ip: string | null;
}

export interface AuthEventRepository {
  /** Grava um evento. Best-effort no caller — nunca bloqueia a resposta HTTP. */
  record(input: AuthEventInput): Promise<void>;

  /** Últimas falhas (`password_fail`/`2fa_fail`/`2fa_expired`) de um usuário — por `userId` OU `name`. */
  recentFailures(opts: { userId?: number | null; name?: string | null; limit?: number }): Promise<AuthFailure[]>;

  /** Retenção — apaga eventos com `at` mais velho que `days`. Devolve quantos. */
  pruneOlderThan(days: number): Promise<number>;
}

export interface DependencyEventRepository {
  /**
   * Registra o evento se ainda não houver um pro trio (session, file, name).
   * `created: false` + o evento existente quando já registrado (não duplica).
   */
  recordIfNew(input: NewDependencyEventInput): Promise<{ event: DependencyEvent; created: boolean }>;

  /** Marca um evento como instalado (`installed = true`, `installed_at = now()`). */
  markInstalled(id: string): Promise<void>;

  /** Eventos da sessão, mais recentes primeiro. */
  listBySession(sessionId: string): Promise<DependencyEvent[]>;
}
