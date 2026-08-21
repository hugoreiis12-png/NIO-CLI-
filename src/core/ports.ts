import type { ProjectConfig } from '../config.js';
import type { ProjectContext } from '../lib/project-context.js';
import type { HistoryEntry } from '../lib/task-history.js';
import type { UsageEvent } from '../lib/telemetry.js';
import type { Database } from '../database.types.js';
import type {
  ActiveSegmentRow,
  AllocationListRow,
  AllocationSegmentRow,
  CreatedTaskRow,
  CurrentTaskState,
  DbTarget,
  DeliveryInput,
  FieldChange,
  IdSetKind,
  ProjectRef,
  QueryResult,
  TaskDetailRefs,
  TaskDetailRows,
  TaskInfoRef,
  TaskListFilter,
  TaskListResult,
  UpdatedTaskRow,
  User,
} from './types.js';

/** Linha crua de uma task (todas as colunas), como o backend devolve. */
type TaskRecord = Database['public']['Tables']['tasks']['Row'];
type TaskInsert = Database['public']['Tables']['tasks']['Insert'];
type TaskUpdate = Database['public']['Tables']['tasks']['Update'];

/**
 * Porta de acesso a dados do NOS, segregada por domínio. As tools dependem
 * DESTAS interfaces, nunca do client do Supabase. Trocar de backend = um novo
 * adaptador que implemente `Gateway` e um `case` no `session-factory`.
 *
 * Contrato de erro: métodos **lançam** `Error` (mensagem pronta pra mostrar) em
 * falha de backend; a tool captura e traduz para `errorResult`.
 */
export interface ContextGateway {
  /** Contexto completo do projeto ativo (projeto, repos, sprint, membros, usuário). */
  getContext(config: ProjectConfig, user: User): Promise<ProjectContext>;
  /** Projetos ativos em que o usuário é membro. */
  listProjects(userId: string): Promise<ProjectRef[]>;
  /** Projeto por id, ou `null` se inexistente / sem acesso (RLS). */
  findProjectById(projectId: string): Promise<ProjectRef | null>;
}

export interface TaskGateway {
  listTasks(filter: TaskListFilter): Promise<TaskListResult>;

  /** Task + suas linhas de relação, ou `null` se não existe / está fora do projeto. */
  getTaskWithRelations(
    taskId: string,
    projectId: string,
  ): Promise<{ task: TaskRecord; rows: TaskDetailRows } | null>;
  /** Resolve perfis/repos/labels referenciados por uma task (2ª fase do detalhe). */
  loadTaskRefs(userIds: string[], repoIds: string[], labelIds: string[]): Promise<TaskDetailRefs>;

  /** Resolve a sprint (active/none/uuid) → id ou null. Throw em validação inválida. */
  resolveSprintId(projectId: string, sprintInput: string): Promise<string | null>;
  /** Cria a task + vínculos secundários + histórico. `warnings` p/ falhas parciais de vínculo. */
  createTask(
    payload: TaskInsert,
    links: { assigneeIds: string[]; labelIds: string[]; repoIds: string[] },
    userId: string,
  ): Promise<{ task: CreatedTaskRow; warnings: string[] }>;

  /** Estado atual da task (p/ o diff), ou `null` se não existe / está fora do projeto. */
  getCurrentTask(taskId: string, projectId: string): Promise<CurrentTaskState | null>;
  /** Sprint alvo do update: `undefined` = não mexer, `null` = tirar da sprint. Throw em validação. */
  resolveNextSprintId(
    projectId: string,
    sprintInput: string | undefined,
  ): Promise<string | null | undefined>;
  /** Aplica o patch escalar (se houver) + registra cada mudança no histórico. */
  applyTaskPatch(
    taskId: string,
    projectId: string,
    userId: string,
    patch: TaskUpdate,
    changes: FieldChange[],
  ): Promise<void>;
  /** Ids atuais de um conjunto de vínculos (assignees/labels) da task. */
  getTaskIdSet(kind: IdSetKind, taskId: string): Promise<string[]>;
  /** Substitui o conjunto de vínculos (delete+insert) + registra no histórico. */
  replaceTaskIdSet(
    kind: IdSetKind,
    taskId: string,
    userId: string,
    nextIds: string[],
    before: string[],
    after: string[],
  ): Promise<void>;
  /** Recarrega a task após o update (colunas de resposta). Throw se falhar. */
  reloadTask(taskId: string): Promise<UpdatedTaskRow>;

  /** Status atual de uma task do projeto, ou `null` se não existe / está fora. */
  getTaskForMove(
    taskId: string,
    projectId: string,
  ): Promise<{ key: string; title: string; status: string } | null>;
  /** Muda o status de uma task + registra no histórico. */
  moveTaskStatus(
    taskId: string,
    projectId: string,
    status: string,
    userId: string,
    oldStatus: string,
  ): Promise<void>;

  /** Comenta numa task (valida que está no projeto). `null` se a task não existe / está fora. */
  commentTask(
    taskId: string,
    projectId: string,
    userId: string,
    content: string,
    historyEntry: HistoryEntry,
  ): Promise<{ id: string; task_id: string; created_at: string } | null>;
}

export interface AllocationGateway {
  /** Abre o ponto do dia; se já há um aberto, devolve-o com `alreadyActive`. */
  startAllocation(userId: string): Promise<{ allocation: { id: string; start_time: string }; alreadyActive: boolean }>;
  /** Encerra o ponto do dia (+ fecha task_allocations abertas). `null` se não havia ponto aberto. */
  endAllocation(
    userId: string,
  ): Promise<{ closed: { id: string; start_time: string; end_time: string | null }; closedTaskAllocations: number } | null>;
  /** Para a task_allocation ativa (ponto do dia segue aberto). `null` se não havia. */
  endTaskAllocation(
    userId: string,
  ): Promise<{
    closed: { id: string; start_time: string; end_time: string | null };
    task: { id: string; key: string | null; title: string | null };
  } | null>;

  /** Histórico de alocações encerradas do usuário (+ segmentos p/ agregar). */
  listMyAllocations(
    userId: string,
    opts: { limit: number; offset: number; from?: string; to?: string },
  ): Promise<{ allocations: AllocationListRow[]; segments: AllocationSegmentRow[] }>;

  /** Estado de cronometragem atual: alocação ativa + segmentos + refs de task/projeto. `null` se sem ponto aberto. */
  getActiveAllocation(userId: string): Promise<{
    allocation: { id: string; start_time: string };
    segments: ActiveSegmentRow[];
    tasksById: Map<string, TaskInfoRef>;
    projectsById: Map<string, string>;
  } | null>;

  /** Começa a cronometrar uma task (fecha a anterior, abre ponto se preciso). `null` se a task não existe / está fora. */
  startTaskAllocation(
    taskId: string,
    projectId: string,
    userId: string,
    isOvertime: boolean,
  ): Promise<{
    taskAllocation: { id: string; start_time: string; is_overtime: boolean };
    task: { id: string; key: string; title: string };
    previousClosed: {
      prev: { id: string; task_id: string };
      closed: { start_time: string; end_time: string | null };
      prevTaskKey: string | null;
    } | null;
    allocationWasCreated: boolean;
  } | null>;
}

export interface AnalyticsGateway {
  /** Persiste uma entrega do loop de build. */
  recordDelivery(row: DeliveryInput): Promise<void>;
  /** Registra um evento de uso (telemetria best-effort, síncrona, nunca lança). */
  track(event: UsageEvent): void;
}

/** Fachada única — composta pelos gateways de domínio, injetada no `ToolContext`. */
export interface Gateway extends ContextGateway, TaskGateway, AllocationGateway, AnalyticsGateway {}

/**
 * Investigação READ-ONLY sobre os bancos PostgreSQL dual-IP (`primary` = novo,
 * `secondary` = antigo). Contrato de erro: **lança** `Error` (mensagem pronta)
 * em falha de conexão, destino não configurado, ou consulta não-DQL.
 *
 * Invariantes (roadmap Fase 1):
 *  - **Destino sempre explícito** — nunca um default silencioso (#4).
 *  - **Somente DQL** — a implementação rejeita não-`SELECT` **antes da rede**
 *    (guarda no código) E abre a sessão do banco como read-only; a role
 *    DQL-only do Postgres é a terceira camada, autoritativa (F12-T3 + F15).
 *
 * Este port é **separado** da `Gateway` de domínio de propósito: é outro
 * backend (Postgres direto via `Bun.sql`, não PostgREST) e não compartilha o
 * caminho de autenticação por-usuário das tools de escrita.
 */
export interface InvestigationGateway {
  /** Consulta read-only no destino explícito. `params` são placeholders posicionais. */
  query(target: DbTarget, sql: string, params?: unknown[]): Promise<QueryResult>;
}
