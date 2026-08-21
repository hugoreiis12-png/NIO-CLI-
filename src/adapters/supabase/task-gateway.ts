import type { DbClient } from './client.js';
import type { Database, TaskStatus, TaskPriority, TaskType } from '../../database.types.js';
import type { TaskGateway } from '../../core/ports.js';
import type {
  CreatedTaskRow,
  CurrentTaskState,
  FieldChange,
  IdSetKind,
  TaskAssignee,
  TaskDetailProfile,
  TaskDetailRefs,
  TaskDetailRepo,
  TaskDetailRows,
  TaskDetailLabel,
  TaskListFilter,
  TaskListItem,
  TaskListResult,
  UpdatedTaskRow,
} from '../../core/types.js';
import { insertTaskHistory, type HistoryEntry } from '../../lib/task-history.js';

type TaskRecord = Database['public']['Tables']['tasks']['Row'];
type TaskInsert = Database['public']['Tables']['tasks']['Insert'];
type TaskUpdate = Database['public']['Tables']['tasks']['Update'];

const SPRINT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Mapeia o conjunto de vínculos → tabela/coluna/campo de histórico + mensagens de erro. */
const ID_SET_SPEC = {
  assignees: {
    table: 'task_assignees', idColumn: 'user_id', historyField: 'assignees',
    fetchErr: 'Erro ao buscar assignees atuais', clearErr: 'Erro ao limpar assignees', insertErr: 'Erro ao gravar novos assignees',
  },
  labels: {
    table: 'task_label_assignments', idColumn: 'label_id', historyField: 'labels',
    fetchErr: 'Erro ao buscar labels atuais', clearErr: 'Erro ao limpar labels', insertErr: 'Erro ao gravar novas labels',
  },
} as const;

/** Linha crua da listagem de tasks (subset de colunas). */
interface TaskRow {
  id: string;
  key: string;
  title: string;
  status: string;
  priority: string;
  type: string;
  sprint_id: string | null;
  end_date: string | null;
  created_at: string;
}
type ProfileLite = { full_name: string | null; username: string | null };
type AssigneeRow = { task_id: string; user_id: string };
type AssigneeRestrict = { mode: 'in' | 'not_in'; ids: string[] } | null;
type SprintFilter = { mode: 'eq'; value: string } | { mode: 'is_null' } | null;
type SprintResolved = { noActive: true } | { noActive: false; filter: SprintFilter };

/** Agrupa assignees (já resolvidos p/ perfil) por task_id. Pura. */
export function groupAssigneesByTask(
  assigneeRows: AssigneeRow[],
  profilesById: Map<string, ProfileLite>,
): Map<string, TaskAssignee[]> {
  const assigneesByTask = new Map<string, TaskAssignee[]>();
  for (const row of assigneeRows) {
    const profile = profilesById.get(row.user_id);
    const list = assigneesByTask.get(row.task_id) ?? [];
    list.push({
      user_id: row.user_id,
      full_name: profile?.full_name ?? null,
      username: profile?.username ?? null,
    });
    assigneesByTask.set(row.task_id, list);
  }
  return assigneesByTask;
}

/** Monta a lista de tasks com assignees embutidos, a partir das linhas + assignees agrupados. Pura. */
export function formatTaskList(
  tasks: TaskRow[],
  assigneesByTask: Map<string, TaskAssignee[]>,
): TaskListItem[] {
  return tasks.map((t) => ({
    id: t.id,
    key: t.key,
    title: t.title,
    status: t.status,
    priority: t.priority,
    type: t.type,
    sprint_id: t.sprint_id,
    end_date: t.end_date,
    created_at: t.created_at,
    assignees: assigneesByTask.get(t.id) ?? [],
  }));
}

/** Adaptador Supabase do `TaskGateway` (listagem, detalhe, CRUD, comentário). */
export function taskGateway(db: DbClient): TaskGateway {
  return {
    async listTasks(filter: TaskListFilter): Promise<TaskListResult> {
      const restrict = await resolveAssigneeFilter(db, filter.userId, filter.assignee);
      const sprint = await resolveSprintFilter(db, filter.projectId, filter.sprint);
      if (sprint.noActive) return { tasks: [], note: 'Não há sprint ativa neste projeto.' };

      // Short-circuit: filtro IN com array vazio → nada bate.
      if (restrict?.mode === 'in' && restrict.ids.length === 0) return { tasks: [] };

      const rows = await queryFilteredTasks(db, filter, restrict, sprint.filter);
      if (rows.length === 0) return { tasks: [] };

      const { assigneeRows, profilesById } = await loadAssigneeProfiles(db, rows.map((t) => t.id));
      return { tasks: formatTaskList(rows, groupAssigneesByTask(assigneeRows, profilesById)) };
    },

    async getTaskWithRelations(
      taskId: string,
      projectId: string,
    ): Promise<{ task: TaskRecord; rows: TaskDetailRows } | null> {
      const taskRes = await db
        .from('tasks')
        .select('*')
        .eq('id', taskId)
        .eq('project_id', projectId)
        .maybeSingle();
      if (taskRes.error) throw new Error(`Erro ao buscar tarefa: ${taskRes.error.message}`);
      if (!taskRes.data) return null;

      const [assigneesRes, checklistRes, commentsRes, historyRes, reposRes, labelsRes] = await Promise.all([
        db.from('task_assignees').select('user_id').eq('task_id', taskId),
        db
          .from('task_checklist_items')
          .select('id, text, checked, order')
          .eq('task_id', taskId)
          .order('order', { ascending: true }),
        db
          .from('task_comments')
          .select('id, content, created_at, updated_at, author_id')
          .eq('task_id', taskId)
          .order('created_at', { ascending: true })
          .limit(50),
        db
          .from('task_history')
          .select('id, action, field, old_value, new_value, created_at, user_id')
          .eq('task_id', taskId)
          .order('created_at', { ascending: false })
          .limit(50),
        db.from('task_repositories').select('repository_id').eq('task_id', taskId),
        db.from('task_label_assignments').select('label_id').eq('task_id', taskId),
      ]);
      if (assigneesRes.error) throw new Error(`Erro ao buscar assignees: ${assigneesRes.error.message}`);
      if (checklistRes.error) throw new Error(`Erro ao buscar checklist: ${checklistRes.error.message}`);
      if (commentsRes.error) throw new Error(`Erro ao buscar comentários: ${commentsRes.error.message}`);
      if (historyRes.error) throw new Error(`Erro ao buscar histórico: ${historyRes.error.message}`);
      if (reposRes.error) throw new Error(`Erro ao buscar repositórios: ${reposRes.error.message}`);
      if (labelsRes.error) throw new Error(`Erro ao buscar labels: ${labelsRes.error.message}`);

      return {
        task: taskRes.data,
        rows: {
          assigneeRows: assigneesRes.data ?? [],
          checklistRows: checklistRes.data ?? [],
          commentRows: commentsRes.data ?? [],
          historyRows: historyRes.data ?? [],
          repoRows: reposRes.data ?? [],
          labelRows: labelsRes.data ?? [],
        },
      };
    },

    async loadTaskRefs(
      userIds: string[],
      repoIds: string[],
      labelIds: string[],
    ): Promise<TaskDetailRefs> {
      const profiles = await fetchProfiles(db, userIds);

      const reposById = new Map<string, TaskDetailRepo>();
      if (repoIds.length > 0) {
        const repoFetch = await db
          .from('repositories')
          .select('id, name, url, default_branch')
          .in('id', repoIds);
        if (repoFetch.error) throw new Error(`Erro ao buscar repositórios: ${repoFetch.error.message}`);
        for (const r of repoFetch.data ?? []) {
          reposById.set(r.id, { name: r.name, url: r.url, default_branch: r.default_branch });
        }
      }

      const labelsById = new Map<string, TaskDetailLabel>();
      if (labelIds.length > 0) {
        const labelFetch = await db.from('task_labels').select('id, name, color').in('id', labelIds);
        if (labelFetch.error) throw new Error(`Erro ao buscar labels: ${labelFetch.error.message}`);
        for (const l of labelFetch.data ?? []) labelsById.set(l.id, { name: l.name, color: l.color });
      }

      return { profiles, reposById, labelsById };
    },

    async resolveSprintId(projectId: string, sprintInput: string): Promise<string | null> {
      if (sprintInput === 'active') {
        const sprintRes = await db
          .from('sprints')
          .select('id')
          .eq('project_id', projectId)
          .eq('status', 'ativa')
          .maybeSingle();
        if (sprintRes.error) throw new Error(`Erro ao buscar sprint ativa: ${sprintRes.error.message}`);
        if (!sprintRes.data) throw new Error('Não há sprint ativa no projeto.');
        return sprintRes.data.id;
      }
      if (sprintInput === 'none') return null;
      if (!SPRINT_UUID_RE.test(sprintInput)) {
        throw new Error('Argumento "sprint" deve ser "active", "none" ou um UUID válido.');
      }
      const sprintRes = await db.from('sprints').select('id, project_id').eq('id', sprintInput).maybeSingle();
      if (sprintRes.error) throw new Error(`Erro ao validar sprint: ${sprintRes.error.message}`);
      if (!sprintRes.data || sprintRes.data.project_id !== projectId) {
        throw new Error('Sprint informada não pertence ao projeto atual.');
      }
      return sprintRes.data.id;
    },

    async createTask(
      payload: TaskInsert,
      links: { assigneeIds: string[]; labelIds: string[]; repoIds: string[] },
      userId: string,
    ): Promise<{ task: CreatedTaskRow; warnings: string[] }> {
      const insertRes = await db
        .from('tasks')
        .insert(payload)
        .select('id, key, title, status, priority, type, sprint_id, end_date, created_at')
        .single();
      if (insertRes.error) throw new Error(`Erro ao criar tarefa: ${insertRes.error.message}`);
      const task = insertRes.data;
      const warnings = await linkSecondaryRecords(db, task.id, links.assigneeIds, links.labelIds, links.repoIds);
      await insertTaskHistory(db, {
        task_id: task.id,
        user_id: userId,
        action: 'created',
        field: 'mcp',
        new_value: task.title,
      });
      return { task, warnings };
    },

    async getCurrentTask(taskId: string, projectId: string): Promise<CurrentTaskState | null> {
      const res = await db
        .from('tasks')
        .select('id, title, description, status, priority, type, sprint_id, end_date, project_id')
        .eq('id', taskId)
        .eq('project_id', projectId)
        .maybeSingle();
      if (res.error) throw new Error(`Erro ao buscar tarefa: ${res.error.message}`);
      return res.data ?? null;
    },

    async resolveNextSprintId(
      projectId: string,
      sprintInput: string | undefined,
    ): Promise<string | null | undefined> {
      if (sprintInput === undefined) return undefined;
      if (sprintInput === 'none') return null;
      if (sprintInput === 'active') {
        const sprintRes = await db
          .from('sprints')
          .select('id')
          .eq('project_id', projectId)
          .eq('status', 'ativa')
          .maybeSingle();
        if (sprintRes.error) throw new Error(`Erro ao buscar sprint ativa: ${sprintRes.error.message}`);
        if (!sprintRes.data) throw new Error('Não há sprint ativa no projeto.');
        return sprintRes.data.id;
      }
      if (!SPRINT_UUID_RE.test(sprintInput)) {
        throw new Error('Argumento "sprint" deve ser "active", "none" ou um UUID válido.');
      }
      const sprintRes = await db.from('sprints').select('id, project_id').eq('id', sprintInput).maybeSingle();
      if (sprintRes.error) throw new Error(`Erro ao validar sprint: ${sprintRes.error.message}`);
      if (!sprintRes.data || sprintRes.data.project_id !== projectId) {
        throw new Error('Sprint informada não pertence ao projeto atual.');
      }
      return sprintRes.data.id;
    },

    async applyTaskPatch(
      taskId: string,
      projectId: string,
      userId: string,
      patch: TaskUpdate,
      changes: FieldChange[],
    ): Promise<void> {
      if (Object.keys(patch).length > 0) {
        const updateRes = await db.from('tasks').update(patch).eq('id', taskId).eq('project_id', projectId);
        if (updateRes.error) throw new Error(`Erro ao atualizar tarefa: ${updateRes.error.message}`);
      }
      for (const ch of changes) {
        await insertTaskHistory(db, {
          task_id: taskId,
          user_id: userId,
          action: 'updated',
          field: ch.field,
          old_value: ch.old_value,
          new_value: ch.new_value,
        });
      }
    },

    async getTaskIdSet(kind: IdSetKind, taskId: string): Promise<string[]> {
      const spec = ID_SET_SPEC[kind];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tabela dinâmica
      const res = await (db.from(spec.table) as any).select(spec.idColumn).eq('task_id', taskId);
      if (res.error) throw new Error(`${spec.fetchErr}: ${res.error.message}`);
      return ((res.data ?? []) as Array<Record<string, string>>).map((r) => r[spec.idColumn]);
    },

    async replaceTaskIdSet(
      kind: IdSetKind,
      taskId: string,
      userId: string,
      nextIds: string[],
      before: string[],
      after: string[],
    ): Promise<void> {
      const spec = ID_SET_SPEC[kind];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tabela dinâmica
      const del = await (db.from(spec.table) as any).delete().eq('task_id', taskId);
      if (del.error) throw new Error(`${spec.clearErr}: ${del.error.message}`);
      if (nextIds.length > 0) {
        const rows = nextIds.map((id) => ({ task_id: taskId, [spec.idColumn]: id }));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tabela dinâmica
        const ins = await (db.from(spec.table) as any).insert(rows);
        if (ins.error) throw new Error(`${spec.insertErr}: ${ins.error.message}`);
      }
      await insertTaskHistory(db, {
        task_id: taskId,
        user_id: userId,
        action: 'updated',
        field: spec.historyField,
        old_value: JSON.stringify(before),
        new_value: JSON.stringify(after),
      });
    },

    async reloadTask(taskId: string): Promise<UpdatedTaskRow> {
      const finalRes = await db
        .from('tasks')
        .select('id, key, title, status, priority, type, sprint_id, end_date, updated_at')
        .eq('id', taskId)
        .single();
      if (finalRes.error) throw new Error(`Tarefa atualizada, mas falhou ao recarregar: ${finalRes.error.message}`);
      return finalRes.data;
    },

    async getTaskForMove(
      taskId: string,
      projectId: string,
    ): Promise<{ key: string; title: string; status: string } | null> {
      const res = await db
        .from('tasks')
        .select('id, key, title, status')
        .eq('id', taskId)
        .eq('project_id', projectId)
        .maybeSingle();
      if (res.error) throw new Error(`Erro ao buscar tarefa: ${res.error.message}`);
      return res.data ?? null;
    },

    async moveTaskStatus(
      taskId: string,
      projectId: string,
      status: string,
      userId: string,
      oldStatus: string,
    ): Promise<void> {
      // Cast: status já validado pela tool (zod) contra o enum gerado.
      const updateRes = await db
        .from('tasks')
        .update({ status: status as TaskStatus })
        .eq('id', taskId)
        .eq('project_id', projectId);
      if (updateRes.error) throw new Error(`Erro ao mover tarefa: ${updateRes.error.message}`);
      await insertTaskHistory(db, {
        task_id: taskId,
        user_id: userId,
        action: 'moved',
        field: 'status',
        old_value: oldStatus,
        new_value: status,
      });
    },

    async commentTask(
      taskId: string,
      projectId: string,
      userId: string,
      content: string,
      historyEntry: HistoryEntry,
    ): Promise<{ id: string; task_id: string; created_at: string } | null> {
      const taskRes = await db
        .from('tasks')
        .select('id')
        .eq('id', taskId)
        .eq('project_id', projectId)
        .maybeSingle();
      if (taskRes.error) throw new Error(`Erro ao validar tarefa: ${taskRes.error.message}`);
      if (!taskRes.data) return null;

      const insertRes = await db
        .from('task_comments')
        .insert({ task_id: taskId, author_id: userId, content })
        .select('id, task_id, created_at')
        .single();
      if (insertRes.error) throw new Error(`Erro ao gravar comentário: ${insertRes.error.message}`);

      await insertTaskHistory(db, historyEntry);
      return insertRes.data;
    },
  };
}

async function resolveAssigneeFilter(
  db: DbClient,
  userId: string,
  assignee: string | undefined,
): Promise<AssigneeRestrict> {
  if (!assignee) return null;
  if (assignee === 'unassigned') {
    const sub = await db.from('task_assignees').select('task_id');
    if (sub.error) throw new Error(`Erro filtrando por assignee: ${sub.error.message}`);
    return { mode: 'not_in', ids: (sub.data ?? []).map((r) => r.task_id) };
  }
  const userFilter = assignee === 'me' ? userId : assignee;
  const sub = await db.from('task_assignees').select('task_id').eq('user_id', userFilter);
  if (sub.error) throw new Error(`Erro filtrando por assignee: ${sub.error.message}`);
  return { mode: 'in', ids: (sub.data ?? []).map((r) => r.task_id) };
}

async function resolveSprintFilter(
  db: DbClient,
  projectId: string,
  sprint: string | undefined,
): Promise<SprintResolved> {
  if (!sprint) return { noActive: false, filter: null };
  if (sprint === 'active') {
    const res = await db
      .from('sprints')
      .select('id')
      .eq('project_id', projectId)
      .eq('status', 'ativa')
      .maybeSingle();
    if (res.error) throw new Error(`Erro ao buscar sprint ativa: ${res.error.message}`);
    if (!res.data) return { noActive: true };
    return { noActive: false, filter: { mode: 'eq', value: res.data.id } };
  }
  if (sprint === 'none') return { noActive: false, filter: { mode: 'is_null' } };
  return { noActive: false, filter: { mode: 'eq', value: sprint } };
}

async function queryFilteredTasks(
  db: DbClient,
  filter: TaskListFilter,
  restrictIds: AssigneeRestrict,
  sprintFilter: SprintFilter,
): Promise<TaskRow[]> {
  let query = db
    .from('tasks')
    .select('id, key, title, status, priority, type, sprint_id, end_date, created_at')
    .eq('project_id', filter.projectId);
  if (restrictIds?.mode === 'in') query = query.in('id', restrictIds.ids);
  else if (restrictIds?.mode === 'not_in' && restrictIds.ids.length > 0)
    query = query.not('id', 'in', `(${restrictIds.ids.join(',')})`);
  if (sprintFilter?.mode === 'eq') query = query.eq('sprint_id', sprintFilter.value);
  else if (sprintFilter?.mode === 'is_null') query = query.is('sprint_id', null);
  // Cast: a porta é neutra (`string[]`), mas estes valores já vêm validados
  // pela tool (zod) contra os mesmos enums — o cast só reconcilia os tipos gerados.
  if (filter.status?.length) query = query.in('status', filter.status as TaskStatus[]);
  if (filter.priority?.length) query = query.in('priority', filter.priority as TaskPriority[]);
  if (filter.type?.length) query = query.in('type', filter.type as TaskType[]);
  if (filter.search) {
    const pattern = `%${filter.search.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    query = query.or(`title.ilike.${pattern},description.ilike.${pattern},key.ilike.${pattern}`);
  }
  query = query
    .order('created_at', { ascending: false })
    .range(filter.offset, filter.offset + filter.limit - 1);
  const { data, error } = await query;
  if (error) throw new Error(`Erro ao listar tarefas: ${error.message}`);
  return data ?? [];
}

async function loadAssigneeProfiles(
  db: DbClient,
  taskIds: string[],
): Promise<{ assigneeRows: AssigneeRow[]; profilesById: Map<string, ProfileLite> }> {
  const assigneesRes = await db.from('task_assignees').select('task_id, user_id').in('task_id', taskIds);
  if (assigneesRes.error) throw new Error(`Erro ao buscar assignees: ${assigneesRes.error.message}`);
  const assigneeRows = assigneesRes.data ?? [];
  const userIds = Array.from(new Set(assigneeRows.map((a) => a.user_id)));
  let profilesById = new Map<string, ProfileLite>();
  if (userIds.length > 0) {
    const profilesRes = await db.from('profiles').select('id, full_name, username').in('id', userIds);
    if (profilesRes.error) throw new Error(`Erro ao buscar perfis: ${profilesRes.error.message}`);
    profilesById = new Map(
      (profilesRes.data ?? []).map((p) => [p.id, { full_name: p.full_name, username: p.username }]),
    );
  }
  return { assigneeRows, profilesById };
}

async function linkSecondaryRecords(
  db: DbClient,
  taskId: string,
  assigneeIds: string[],
  labelIds: string[],
  repoIds: string[],
): Promise<string[]> {
  const results = await Promise.all([
    insertTaskLinks(db, 'task_assignees', 'user_id', 'assignees', taskId, assigneeIds),
    insertTaskLinks(db, 'task_label_assignments', 'label_id', 'labels', taskId, labelIds),
    insertTaskLinks(db, 'task_repositories', 'repository_id', 'repositories', taskId, repoIds),
  ]);
  return results.filter((w): w is string => w !== null);
}

async function insertTaskLinks(
  db: DbClient,
  table: 'task_assignees' | 'task_label_assignments' | 'task_repositories',
  idField: 'user_id' | 'label_id' | 'repository_id',
  label: string,
  taskId: string,
  ids: string[],
): Promise<string | null> {
  if (ids.length === 0) return null;
  const rows = ids.map((id) => ({ task_id: taskId, [idField]: id }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tabela dinâmica
  const res = await (db.from(table) as any).insert(rows);
  return res.error ? `Falha ao vincular ${label}: ${res.error.message}` : null;
}

async function fetchProfiles(db: DbClient, userIds: string[]): Promise<Map<string, TaskDetailProfile>> {
  if (userIds.length === 0) return new Map();
  const res = await db
    .from('profiles')
    .select('id, full_name, username, avatar_url')
    .in('id', userIds);
  if (res.error) throw new Error(`Erro ao buscar perfis: ${res.error.message}`);
  return new Map(
    (res.data ?? []).map((p) => [
      p.id,
      { full_name: p.full_name, username: p.username, avatar_url: p.avatar_url },
    ]),
  );
}
