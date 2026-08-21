import type { DbClient } from './client.js';
import type { AllocationGateway } from '../../core/ports.js';
import type {
  ActiveSegmentRow,
  AllocationListRow,
  AllocationSegmentRow,
  TaskInfoRef,
} from '../../core/types.js';

/** Adaptador Supabase do `AllocationGateway` (ponto do dia + timers de task). */
export function allocationGateway(db: DbClient): AllocationGateway {
  return {
    async startAllocation(
      userId: string,
    ): Promise<{ allocation: { id: string; start_time: string }; alreadyActive: boolean }> {
      const activeRes = await db
        .from('allocations')
        .select('id, start_time')
        .eq('user_id', userId)
        .is('end_time', null)
        .maybeSingle();
      if (activeRes.error) throw new Error(`Erro ao buscar alocação ativa: ${activeRes.error.message}`);
      if (activeRes.data) return { allocation: activeRes.data, alreadyActive: true };

      const insertRes = await db
        .from('allocations')
        .insert({ user_id: userId })
        .select('id, start_time')
        .single();
      if (insertRes.error) throw new Error(`Erro ao iniciar alocação: ${insertRes.error.message}`);
      return { allocation: insertRes.data, alreadyActive: false };
    },

    async endAllocation(
      userId: string,
    ): Promise<{
      closed: { id: string; start_time: string; end_time: string | null };
      closedTaskAllocations: number;
    } | null> {
      const activeRes = await db
        .from('allocations')
        .select('id, start_time')
        .eq('user_id', userId)
        .is('end_time', null)
        .maybeSingle();
      if (activeRes.error) throw new Error(`Erro ao buscar alocação ativa: ${activeRes.error.message}`);
      if (!activeRes.data) return null;
      const allocationId = activeRes.data.id;
      const now = new Date().toISOString();

      // Fecha task_allocations abertas dessa allocation em paralelo com o close da allocation.
      const [taskCloseRes, allocCloseRes] = await Promise.all([
        db
          .from('task_allocations')
          .update({ end_time: now })
          .eq('allocation_id', allocationId)
          .is('end_time', null)
          .select('id'),
        db
          .from('allocations')
          .update({ end_time: now })
          .eq('id', allocationId)
          .select('id, start_time, end_time')
          .single(),
      ]);
      if (taskCloseRes.error) throw new Error(`Erro ao fechar task_allocations: ${taskCloseRes.error.message}`);
      if (allocCloseRes.error) throw new Error(`Erro ao encerrar alocação: ${allocCloseRes.error.message}`);
      return { closed: allocCloseRes.data, closedTaskAllocations: (taskCloseRes.data ?? []).length };
    },

    async endTaskAllocation(
      userId: string,
    ): Promise<{
      closed: { id: string; start_time: string; end_time: string | null };
      task: { id: string; key: string | null; title: string | null };
    } | null> {
      const activeRes = await db
        .from('task_allocations')
        .select('id, task_id, start_time')
        .eq('user_id', userId)
        .is('end_time', null)
        .maybeSingle();
      if (activeRes.error) throw new Error(`Erro ao buscar task_allocation ativa: ${activeRes.error.message}`);
      if (!activeRes.data) return null;
      const active = activeRes.data;
      const now = new Date().toISOString();

      const closeRes = await db
        .from('task_allocations')
        .update({ end_time: now })
        .eq('id', active.id)
        .select('id, start_time, end_time')
        .single();
      if (closeRes.error) throw new Error(`Erro ao parar task_allocation: ${closeRes.error.message}`);

      // Info da task é best-effort (não falha o close se a task sumiu).
      const taskRes = await db
        .from('tasks')
        .select('id, key, title')
        .eq('id', active.task_id)
        .maybeSingle();
      const task = taskRes.data ?? { id: active.task_id, key: null, title: null };
      return { closed: closeRes.data, task };
    },

    async listMyAllocations(
      userId: string,
      opts: { limit: number; offset: number; from?: string; to?: string },
    ): Promise<{ allocations: AllocationListRow[]; segments: AllocationSegmentRow[] }> {
      let query = db
        .from('allocations')
        .select('id, start_time, end_time, auto_closed')
        .eq('user_id', userId)
        .not('end_time', 'is', null);
      if (opts.from) query = query.gte('start_time', `${opts.from.slice(0, 10)}T00:00:00Z`);
      if (opts.to) query = query.lte('start_time', `${opts.to.slice(0, 10)}T23:59:59Z`);
      query = query
        .order('start_time', { ascending: false })
        .range(opts.offset, opts.offset + opts.limit - 1);
      const { data, error } = await query;
      if (error) throw new Error(`Erro ao listar alocações: ${error.message}`);
      const allocations = data ?? [];
      if (allocations.length === 0) return { allocations: [], segments: [] };

      const segRes = await db
        .from('task_allocations')
        .select('allocation_id, start_time, end_time')
        .in('allocation_id', allocations.map((a) => a.id));
      if (segRes.error) throw new Error(`Erro ao buscar segmentos: ${segRes.error.message}`);
      return { allocations, segments: segRes.data ?? [] };
    },

    async getActiveAllocation(userId: string): Promise<{
      allocation: { id: string; start_time: string };
      segments: ActiveSegmentRow[];
      tasksById: Map<string, TaskInfoRef>;
      projectsById: Map<string, string>;
    } | null> {
      const allocRes = await db
        .from('allocations')
        .select('id, start_time')
        .eq('user_id', userId)
        .is('end_time', null)
        .maybeSingle();
      if (allocRes.error) throw new Error(`Erro ao buscar alocação ativa: ${allocRes.error.message}`);
      if (!allocRes.data) return null;
      const allocation = allocRes.data;

      const segmentsRes = await db
        .from('task_allocations')
        .select('id, task_id, start_time, end_time, is_overtime')
        .eq('allocation_id', allocation.id)
        .order('start_time', { ascending: true });
      if (segmentsRes.error) throw new Error(`Erro ao buscar segmentos: ${segmentsRes.error.message}`);
      const segments = segmentsRes.data ?? [];

      const { tasksById, projectsById } = await loadTaskAndProjectRefs(
        db,
        Array.from(new Set(segments.map((s) => s.task_id))),
      );
      return { allocation, segments, tasksById, projectsById };
    },

    async startTaskAllocation(
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
    } | null> {
      const taskRes = await db
        .from('tasks')
        .select('id, key, title, project_id')
        .eq('id', taskId)
        .eq('project_id', projectId)
        .maybeSingle();
      if (taskRes.error) throw new Error(`Erro ao buscar tarefa: ${taskRes.error.message}`);
      if (!taskRes.data) return null;
      const task = taskRes.data;
      const now = new Date().toISOString();

      const alloc = await ensureActiveAllocation(db, userId);
      const previousClosed = await closePreviousTaskAllocation(db, userId, now);

      const insertRes = await db
        .from('task_allocations')
        .insert({ allocation_id: alloc.allocationId, task_id: taskId, user_id: userId, start_time: now, is_overtime: isOvertime })
        .select('id, start_time, is_overtime')
        .single();
      if (insertRes.error) throw new Error(`Erro ao iniciar task_allocation: ${insertRes.error.message}`);
      return {
        taskAllocation: insertRes.data,
        task: { id: task.id, key: task.key, title: task.title },
        previousClosed,
        allocationWasCreated: alloc.wasCreated,
      };
    },
  };
}

async function loadTaskAndProjectRefs(
  db: DbClient,
  taskIds: string[],
): Promise<{ tasksById: Map<string, TaskInfoRef>; projectsById: Map<string, string> }> {
  const tasksById = new Map<string, TaskInfoRef>();
  const projectsById = new Map<string, string>();
  if (taskIds.length === 0) return { tasksById, projectsById };

  const tasksRes = await db.from('tasks').select('id, key, title, project_id').in('id', taskIds);
  if (tasksRes.error) throw new Error(`Erro ao buscar tarefas: ${tasksRes.error.message}`);
  for (const t of tasksRes.data ?? []) {
    tasksById.set(t.id, { key: t.key, title: t.title, project_id: t.project_id });
  }

  const projectIds = Array.from(new Set((tasksRes.data ?? []).map((t) => t.project_id)));
  if (projectIds.length > 0) {
    const projectsRes = await db.from('projects').select('id, name').in('id', projectIds);
    if (projectsRes.error) throw new Error(`Erro ao buscar projetos: ${projectsRes.error.message}`);
    for (const p of projectsRes.data ?? []) projectsById.set(p.id, p.name);
  }
  return { tasksById, projectsById };
}

/** Reaproveita a allocation (ponto) ativa do usuário ou cria uma. */
async function ensureActiveAllocation(
  db: DbClient,
  userId: string,
): Promise<{ allocationId: string; wasCreated: boolean }> {
  const activeAllocRes = await db
    .from('allocations')
    .select('id')
    .eq('user_id', userId)
    .is('end_time', null)
    .maybeSingle();
  if (activeAllocRes.error) throw new Error(`Erro ao buscar alocação ativa: ${activeAllocRes.error.message}`);
  if (activeAllocRes.data) return { allocationId: activeAllocRes.data.id, wasCreated: false };
  const newAlloc = await db.from('allocations').insert({ user_id: userId }).select('id').single();
  if (newAlloc.error) throw new Error(`Erro ao iniciar alocação: ${newAlloc.error.message}`);
  return { allocationId: newAlloc.data.id, wasCreated: true };
}

/** Fecha a task_allocation ativa anterior do usuário, se houver. */
async function closePreviousTaskAllocation(
  db: DbClient,
  userId: string,
  now: string,
): Promise<{
  prev: { id: string; task_id: string };
  closed: { start_time: string; end_time: string | null };
  prevTaskKey: string | null;
} | null> {
  const activeRes = await db
    .from('task_allocations')
    .select('id, task_id, start_time')
    .eq('user_id', userId)
    .is('end_time', null)
    .maybeSingle();
  if (activeRes.error) throw new Error(`Erro ao buscar task_allocation ativa: ${activeRes.error.message}`);
  if (!activeRes.data) return null;
  const prev = activeRes.data;

  const closeRes = await db
    .from('task_allocations')
    .update({ end_time: now })
    .eq('id', prev.id)
    .select('id, start_time, end_time')
    .single();
  if (closeRes.error) throw new Error(`Erro ao fechar task_allocation anterior: ${closeRes.error.message}`);

  // Key da task anterior é best-effort (retorno informativo).
  const prevTask = await db.from('tasks').select('id, key').eq('id', prev.task_id).maybeSingle();
  return {
    prev: { id: prev.id, task_id: prev.task_id },
    closed: { start_time: closeRes.data.start_time, end_time: closeRes.data.end_time },
    prevTaskKey: prevTask.data?.key ?? null,
  };
}
