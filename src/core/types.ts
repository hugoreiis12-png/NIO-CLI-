/**
 * Tipos de domínio — shapes que as tools falam, sem qualquer vínculo com o
 * backend. Nenhum import de `@supabase` aqui: é o vocabulário neutro que os
 * adaptadores (Supabase hoje, outro amanhã) precisam produzir/consumir.
 */

/** Usuário autenticado (já resolvido pelo IdentityProvider). */
export interface User {
  id: string;
  email: string;
  full_name: string | null;
  username: string | null;
}

/** Referência enxuta a um projeto (listagem / validação de acesso). */
export interface ProjectRef {
  id: string;
  name: string;
}

export interface TaskAssignee {
  user_id: string;
  full_name: string | null;
  username: string | null;
}

/** Task já formatada para retorno (com assignees embutidos). */
export interface TaskListItem {
  id: string;
  key: string;
  title: string;
  status: string;
  priority: string;
  type: string;
  sprint_id: string | null;
  end_date: string | null;
  created_at: string;
  assignees: TaskAssignee[];
}

/**
 * Filtro de `listTasks`. `assignee` aceita "me" | "unassigned" | UUID; `sprint`
 * aceita "active" | "none" | UUID — a resolução desses aliases é do adaptador.
 * As listas já vêm validadas pela tool (zod), então aqui são `string[]` planos.
 */
export interface TaskListFilter {
  projectId: string;
  userId: string;
  status?: string[];
  priority?: string[];
  type?: string[];
  search?: string;
  assignee?: string;
  sprint?: string;
  limit: number;
  offset: number;
}

export interface TaskListResult {
  tasks: TaskListItem[];
  /** Nota informativa opcional (ex.: "não há sprint ativa"). */
  note?: string;
}

/** Alocação encerrada (histórico) — linha crua p/ a listagem. */
export interface AllocationListRow {
  id: string;
  start_time: string;
  end_time: string | null;
  auto_closed: boolean;
}
/** Segmento (task_allocation) usado no agregado da listagem. */
export interface AllocationSegmentRow {
  allocation_id: string;
  start_time: string;
  end_time: string | null;
}
/** Segmento da alocação ativa (com task e overtime). */
export interface ActiveSegmentRow {
  id: string;
  task_id: string;
  start_time: string;
  end_time: string | null;
  is_overtime: boolean;
}
/** Info mínima de task p/ resolver segmentos → projeto. */
export interface TaskInfoRef {
  key: string;
  title: string;
  project_id: string;
}

/** Linhas de relação de uma task (detalhe), como vêm do backend. */
export interface TaskDetailRows {
  assigneeRows: Array<{ user_id: string }>;
  checklistRows: Array<{ id: string; text: string; checked: boolean; order: number }>;
  commentRows: Array<{ id: string; content: string; created_at: string; updated_at: string; author_id: string }>;
  historyRows: Array<{
    id: string; action: string; field: string | null; old_value: string | null;
    new_value: string | null; created_at: string; user_id: string;
  }>;
  repoRows: Array<{ repository_id: string }>;
  labelRows: Array<{ label_id: string }>;
}
export interface TaskDetailProfile { full_name: string | null; username: string | null; avatar_url: string | null }
export interface TaskDetailRepo { name: string; url: string; default_branch: string }
export interface TaskDetailLabel { name: string; color: string }
/** Refs resolvidas (perfis/repos/labels) p/ montar o detalhe da task. */
export interface TaskDetailRefs {
  profiles: Map<string, TaskDetailProfile>;
  reposById: Map<string, TaskDetailRepo>;
  labelsById: Map<string, TaskDetailLabel>;
}

/** Diff de um campo p/ o histórico (produzido pela tool, aplicado pelo gateway). */
export interface FieldChange {
  field: string;
  old_value: string | null;
  new_value: string | null;
}
/** Estado atual da task p/ o diff do update. */
export interface CurrentTaskState {
  title: string; description: string | null; status: string; priority: string;
  type: string; sprint_id: string | null; end_date: string | null;
}
/** Qual conjunto de vínculos sincronizar no update. */
export type IdSetKind = 'assignees' | 'labels';

/** Task recém-criada (colunas retornadas pelo create). */
export interface CreatedTaskRow {
  id: string; key: string; title: string; status: string; priority: string;
  type: string; sprint_id: string | null; end_date: string | null; created_at: string;
}
/** Task recarregada após update. */
export interface UpdatedTaskRow {
  id: string; key: string; title: string; status: string; priority: string;
  type: string; sprint_id: string | null; end_date: string | null; updated_at: string;
}

/**
 * Destino de banco na investigação read-only dual-IP (P01 do roadmap):
 * `primary` = banco novo (192.168.0.142), `secondary` = banco antigo
 * (192.168.0.250). Nunca há default silencioso — o destino é sempre explícito
 * (Invariante #4). O mapa host→destino vive em `adapters/postgres/targets.ts`.
 */
export type DbTarget = 'primary' | 'secondary';

/** Resultado cru de uma consulta read-only de investigação. */
export interface QueryResult {
  /** Linhas como objetos coluna→valor, na ordem em que o banco devolveu. */
  rows: Record<string, unknown>[];
  /** Número de linhas retornadas. */
  rowCount: number;
  /** Nomes das colunas na ordem do SELECT (p/ render tabular estável). */
  fields: string[];
}

/** Linha de entrega (loop de build) a persistir. */
export interface DeliveryInput {
  user_id: string;
  project_id: string;
  task_id: string | null;
  title: string;
  pr_url: string | null;
  iterations: number | null;
  client: string | null;
}
