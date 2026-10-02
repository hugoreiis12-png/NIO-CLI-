/**
 * Domínio da execução durável — `tasks` e `task_steps` de `db/schema.sql`.
 * Zero IO: os adapters (`adapters/pg/*`) implementam os ports daqui.
 *
 * Estado de task é fonte da verdade do domínio, como `sessions` — por isso estes
 * ports **lançam** em falha (igual ao `SessionRepository`) em vez de devolver
 * `{status, error}` como os gateways de IO externo. A resiliência do worker mora
 * no try/catch do loop, não no contrato.
 */
import type { AwaitingKind, Profile, TaskKind, TaskStatus, StepStatus } from './types.js';

/** Uma tool chamada dentro de um step — trilha, não o payload inteiro. */
export interface ToolCallTrace {
  tool: string;
  status: string;
  durationMs?: number;
}

/**
 * `tasks` — uma request do usuário virada unidade de trabalho persistente.
 *
 * `sessionId` é **proveniência**: a task não pausa nem morre quando o usuário
 * troca de sessão ativa, e sobrevive à sessão apagada (`ON DELETE SET NULL`).
 * `profile` é snapshot justamente para a task não depender da sessão viva.
 */
export interface Task {
  id: string;
  sessionId: string | null;
  userId: number;
  profile: Profile;
  goal: string;
  status: TaskStatus;
  /** `step_number` em execução; `null` antes do planejamento. */
  currentStep: number | null;
  /** Teto anti-loop: `INCOMPLETE` eterno não pode queimar o backend. */
  maxSteps: number;
  /** Short-term memory do turno. Populado só na F2; em F1 fica `{}`. */
  workingSet: Record<string, unknown>;
  /** Sessão do opencode, para re-attach depois de um restart do worker. */
  engineSessionId: string | null;
  result: string | null;
  error: string | null;
  attempts: number;
  /** Fencing token: worker zumbi com `fence` velho não grava. */
  fence: number;
  lockedBy: string | null;
  lockedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  /** O que estacionou a task. `null` = não está esperando ninguém. */
  awaitingKind: AwaitingKind | null;
  /** Tool ou pergunta que estacionou — é o que o `approve` libera. */
  awaitingSubject: string | null;
  /** Concessões pontuais do humano para ESTA task. Nome exato, sem curinga. */
  approvedTools: string[];
  kind: TaskKind;
}

/**
 * `task_steps` — a trilha. Uma linha por (step, tentativa): retry **não**
 * sobrescreve, porque o que falhou na tentativa 1 é a informação mais valiosa.
 */
export interface TaskStep {
  id: number;
  taskId: string;
  stepNumber: number;
  attempt: number;
  name: string;
  status: StepStatus;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  toolCalls: ToolCallTrace[] | null;
  tokensIn: number | null;
  tokensOut: number | null;
  error: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface NewTaskInput {
  userId: number;
  sessionId: string | null;
  profile: Profile;
  goal: string;
  maxSteps?: number;
  /** Default `agent`. `chat` marca turno da TUI (nasce `running`, ver `beginTurn`). */
  kind?: TaskKind;
  /** Default `pending`. Turno de chat nasce `running` pra fila não enxergá-lo. */
  status?: TaskStatus;
}

/** Step a inserir — `attempt` e `status` são do repositório, não do chamador. */
export interface NewStepInput {
  stepNumber: number;
  name: string;
  input?: Record<string, unknown>;
}

/** Resultado de um step concluído, gravado no fim da execução. */
export interface StepResult {
  output: Record<string, unknown>;
  toolCalls?: ToolCallTrace[];
  tokensIn?: number;
  tokensOut?: number;
}

/** Opções de listagem. `kinds` ausente = todos — quem recorta é o chamador. */
export interface ListTasksOpts {
  limit?: number;
  offset?: number;
  kinds?: readonly TaskKind[];
}

export interface TaskRepository {
  create(input: NewTaskInput): Promise<Task>;
  findById(id: string): Promise<Task | null>;
  /** Tasks do usuário, mais recentes primeiro. Sempre paginado. */
  listByUser(userId: number, opts?: ListTasksOpts): Promise<Task[]>;
  /**
   * Transição de estado. `fence` obriga o chamador a provar que ainda detém o
   * lease — `false` = perdeu a corrida, não escreveu nada.
   */
  setStatus(id: string, status: TaskStatus, fence: number, patch?: TaskPatch): Promise<boolean>;
  /** Encerra a task com sucesso (`completed_at` + `result`). */
  complete(id: string, fence: number, result: string): Promise<boolean>;
  /** Encerra em falha; `attempts` já incrementado pelo chamador. */
  fail(id: string, fence: number, error: string): Promise<boolean>;
  /** Cancelamento pelo usuário — não exige lease, não há worker dono. */
  cancel(id: string, userId: number): Promise<boolean>;
  /**
   * Libera a tool que estacionou a task e devolve à fila. Sem `fence`: quem
   * aprova é o dono, não o worker. `false` = a task não estava esperando.
   */
  approve(id: string, userId: number, tool: string): Promise<boolean>;
}

/** Campos opcionais de uma transição — só o que mudou vai pro `UPDATE`. */
export interface TaskPatch {
  currentStep?: number | null;
  engineSessionId?: string | null;
  workingSet?: Record<string, unknown>;
  error?: string | null;
  awaitingKind?: AwaitingKind | null;
  awaitingSubject?: string | null;
}

export interface StepRepository {
  /** Insere o plano inteiro numa transação — plano pela metade não existe. */
  insertAll(taskId: string, steps: readonly NewStepInput[]): Promise<TaskStep[]>;
  /** Todos os steps da task, por `step_number` e `attempt`. */
  listByTask(taskId: string): Promise<TaskStep[]>;
  /** O próximo step a executar (`pending`, menor `step_number`). */
  nextPending(taskId: string): Promise<TaskStep | null>;
  /** Marca `running` + `started_at`. */
  start(stepId: number): Promise<void>;
  /**
   * Devolve um step `running` para `pending`, sem gastar uma tentativa.
   *
   * Necessário porque `start` é chamado ANTES de executar: um step que para para
   * esperar aprovação humana ficaria preso em `running`, e o `nextPending` nunca
   * mais o encontraria — a task não retomaria depois do `nio task approve`.
   */
  reopen(stepId: number): Promise<void>;
  finish(stepId: number, result: StepResult): Promise<void>;
  /** Marca `failed`; o retry entra como `attempt + 1`, não sobrescreve. */
  failStep(stepId: number, error: string): Promise<void>;
  /** Nova tentativa do mesmo `step_number`, com `attempt` incrementado. */
  retry(stepId: number): Promise<TaskStep>;
  /** Acrescenta steps ao fim (Validator julgou `INCOMPLETE`). */
  append(taskId: string, steps: readonly NewStepInput[]): Promise<TaskStep[]>;
  /** Maior `step_number` da task — base para o `append` sem colidir. */
  lastStepNumber(taskId: string): Promise<number>;
}

/**
 * Fila em Postgres (`FOR UPDATE SKIP LOCKED`), sem broker — ADR 0014 fixou uma
 * instância e esta escala não justifica Redis/RabbitMQ.
 */
export interface TaskQueue {
  /**
   * Reivindica a task `pending` mais antiga **do próprio usuário** e devolve com
   * o `fence` já incrementado. `null` = nada na fila.
   */
  claim(workerId: string, userId: number): Promise<Task | null>;
  /** Renova o lease. `false` = perdeu o lease (outro worker reivindicou). */
  heartbeat(taskId: string, workerId: string, fence: number): Promise<boolean>;
  /** Solta o lease sem mudar o status — o worker terminou seu ciclo. */
  release(taskId: string, workerId: string, fence: number): Promise<void>;
  /**
   * Devolve pra `pending` as tasks cujo lease venceu (worker morreu no meio).
   * Sem isto, um crash trava a task em `running` para sempre.
   */
  reclaimExpired(olderThanMs: number): Promise<number>;
  /** Acorda os workers ouvindo (`NOTIFY`). Best-effort. */
  notifyNew(): Promise<void>;
  /**
   * Bloqueia até chegar `NOTIFY` ou estourar `timeoutMs`. O timeout é a rede de
   * segurança para um `NOTIFY` perdido — nunca a via principal.
   */
  waitForNew(signal: AbortSignal, timeoutMs: number): Promise<void>;
}
