/**
 * Domínio v2 (orquestrador de ambientes) — vocabulário neutro das 5 tabelas de
 * `db/schema.sql`, sem vínculo com o driver de banco. Os adapters (`adapters/pg/*`)
 * produzem/consomem estes shapes; nenhum import de `pg` aqui.
 *
 * Convenção: os `CHECK (... IN (...))` do schema viram union types (fonte única);
 * colunas `snake_case` do banco viram `camelCase` mapeadas no adapter.
 */

// ─── Enums do schema (CHECK constraints) ───────────────────────────────

/** `sessions.profile` — perfil de ambiente escolhido no wizard. */
export type Profile = 'fullstack' | 'analyst' | 'scientist' | 'dba' | 'qa' | 'bi';

/** `sessions.status` — ciclo de vida da sessão. */
export type SessionStatus = 'active' | 'paused' | 'archived';

/** `sessions.ide` — editor materializado para a sessão. */
export type Ide = 'terminal' | 'vscode' | 'cursor' | 'other';

/** `dependency_events.dependency_type` — ecossistema da dependência detectada. */
export type DependencyType = 'npm' | 'pip' | 'cargo' | 'gem' | 'composer' | 'unknown';

/**
 * `tasks.status` — ciclo de vida da execução durável.
 *
 * `planning` existe porque os steps não são conhecidos antes de alguém gerá-los;
 * `waiting_approval` é o human-in-the-loop (vale em todo perfil); e o caminho de
 * volta a `pending` cobre a lease vencida — sem ele um worker morto trava a task
 * em `running` para sempre.
 */
export type TaskStatus =
  | 'pending'
  | 'planning'
  | 'running'
  | 'waiting_approval'
  | 'validating'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * `tasks.awaiting_kind` — por que a task estacionou. Permissão de tool é
 * destravável com `nio task approve`; pergunta do motor, não (ninguém responde
 * headless) — a distinção existe pra não prometer uma destrava que não funciona.
 */
export type AwaitingKind = 'approval' | 'question';

/**
 * `tasks.kind` — quem executa. `agent` é do `nio-worker` (headless, permissão
 * estaciona); `chat` é da TUI, em processo, com humano na frente (permissão vai
 * ao modal). O worker NUNCA reivindica `chat`: re-executaria o turno do usuário.
 */
export type TaskKind = 'agent' | 'chat';

/** `task_steps.status` — a espera por tool vive aqui, não no status da task. */
export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

// ─── Config da sessão (sessions.config JSONB) ──────────────────────────

/**
 * Conteúdo tipado do `sessions.config` (JSONB). Tudo opcional: uma sessão recém
 * criada pode ter só o perfil e ir ganhando itens conforme materializa.
 */
export interface EnvironmentConfig {
  languages?: string[];
  toolchains?: string[];
  frameworks?: string[];
  mcps?: string[];
  envVars?: Record<string, string>;
  aliases?: Record<string, string>;
  /** Campo livre para dados de perfil ainda não formalizados. */
  extra?: Record<string, unknown>;
}

// ─── Entidades (uma por tabela) ────────────────────────────────────────

/**
 * `user_cli` — usuário autenticado na CLI. **Nunca** carrega o hash de senha:
 * o `password` fica confinado ao adapter (verificação via `lib/auth/password`).
 */
export interface UserCli {
  id: number;
  name: string;
  auth2: boolean;
  /** E.164 do WhatsApp do 2º fator; `null` = 2FA desativado. */
  phone: string | null;
  ipsUsing: string[];
  timestampCreation: Date;
  timestampPasswordChange: Date | null;
  timestampLastSession: Date | null;
}

/** `login_challenges.purpose` — pra que serve o desafio de OTP. */
export type ChallengePurpose = 'login' | 'enable_2fa';

/**
 * `login_challenges` — desafio de OTP em andamento (2º fator). Uso único, TTL
 * curto, 3 tentativas. `codeHash` é HMAC — o código puro nunca é persistido.
 */
export interface LoginChallenge {
  id: string; // UUID
  userId: number;
  purpose: ChallengePurpose;
  codeHash: string;
  channel: 'whatsapp';
  attempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
}

/** `sessions` — fonte da verdade do ambiente (hub do modelo). */
export interface Session {
  id: string; // UUID
  userId: number;
  name: string;
  profile: Profile;
  status: SessionStatus;
  projectPath: string;
  ide: Ide;
  config: EnvironmentConfig;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * `auth_sessions` — sessão de login (JWT), separada de `Session` (ambiente).
 * `id` dobra como `jti` embutido no token; sem invariante de unicidade —
 * multi-dispositivo é várias linhas ativas ao mesmo tempo para o mesmo usuário.
 */
export interface AuthSession {
  id: string; // UUID, = jti do JWT
  userId: number;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

/** `log_session` — metadata de execução, ligada à sessão dona (session_id UUID). */
export interface SessionLog {
  id: number;
  sessionId: string;
  userId: number; // id_user_create
  hashIdentification: string;
  systemVersionOs: string | null;
  versionCli: string;
  modelContext: string | null;
  timestampCreation: Date;
}

/** `session_activity` — atividade individual dentro de uma sessão. */
export interface SessionActivity {
  id: number;
  sessionId: string;
  messageUser: string | null; // mensage_user
  contextSession: Record<string, unknown>;
  tools: unknown[];
  hashActivity: string | null;
  sequenceLogicNumber: number | null;
  timestampCreation: Date;
}

/** `dependency_events` — evento detectado pelo watcher de dependências. */
export interface DependencyEvent {
  id: string; // UUID
  sessionId: string;
  filePath: string;
  dependencyName: string;
  dependencyType: DependencyType;
  detectedAt: Date;
  installed: boolean;
  installedAt: Date | null;
}
