/**
 * Implementação Postgres do `TaskRepository` (port em `core/tasks.ts`).
 *
 * Diferente do `LessonStore`, **lança** em falha: estado de task é fonte da
 * verdade do domínio (como `sessions`), não acessório. Quem precisa de
 * resiliência é o loop do worker, no try/catch dele.
 *
 * Toda transição do worker exige `fence` — o token do lease. `false` no retorno
 * significa "perdeu a corrida, não escreveu nada", nunca "erro".
 */
import type { AwaitingKind, Profile, TaskKind, TaskStatus } from '../../core/types.js';
import type { ListTasksOpts, NewTaskInput, Task, TaskPatch, TaskRepository } from '../../core/tasks.js';
import { query } from './client.js';

/** Exportado para a fila reusar o mesmo shape no `RETURNING` do claim. */
export interface TaskRow {
  id: string;
  session_id: string | null;
  user_id: string; // BIGINT vem como string no pg
  profile: Profile;
  goal: string;
  status: TaskStatus;
  current_step: number | null;
  max_steps: number;
  working_set: Record<string, unknown> | null;
  engine_session_id: string | null;
  result: string | null;
  error: string | null;
  attempts: number;
  fence: string; // BIGINT
  locked_by: string | null;
  locked_at: Date | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
  awaiting_kind: AwaitingKind | null;
  awaiting_subject: string | null;
  approved_tools: string[] | null;
  kind: TaskKind;
}

export const TASK_COLS = `id, session_id, user_id, profile, goal, status, current_step,
  max_steps, working_set, engine_session_id, result, error, attempts, fence,
  locked_by, locked_at, created_at, updated_at, completed_at,
  awaiting_kind, awaiting_subject, approved_tools, kind`;

/** Linha do banco → entidade do domínio (snake_case → camelCase). */
export function mapTaskRow(row: TaskRow): Task {
  return {
    id: row.id,
    sessionId: row.session_id,
    userId: Number(row.user_id),
    profile: row.profile,
    goal: row.goal,
    status: row.status,
    currentStep: row.current_step,
    maxSteps: row.max_steps,
    workingSet: row.working_set ?? {},
    engineSessionId: row.engine_session_id,
    result: row.result,
    error: row.error,
    attempts: row.attempts,
    fence: Number(row.fence),
    lockedBy: row.locked_by,
    lockedAt: row.locked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    awaitingKind: row.awaiting_kind,
    awaitingSubject: row.awaiting_subject,
    approvedTools: row.approved_tools ?? [],
    kind: row.kind,
  };
}

/** Monta os `SET` opcionais de uma transição, já parametrizados. */
function patchClauses(patch: TaskPatch, from: number): { sql: string[]; values: unknown[] } {
  const sql: string[] = [];
  const values: unknown[] = [];
  const add = (col: string, value: unknown, cast = ''): void => {
    sql.push(`${col} = $${from + values.length}${cast}`);
    values.push(value);
  };
  if ('currentStep' in patch) add('current_step', patch.currentStep ?? null);
  if ('engineSessionId' in patch) add('engine_session_id', patch.engineSessionId ?? null);
  if ('workingSet' in patch) add('working_set', JSON.stringify(patch.workingSet ?? {}), '::jsonb');
  if ('error' in patch) add('error', patch.error ?? null);
  if ('awaitingKind' in patch) add('awaiting_kind', patch.awaitingKind ?? null);
  if ('awaitingSubject' in patch) add('awaiting_subject', patch.awaitingSubject ?? null);
  return { sql, values };
}

export function createTaskRepository(): TaskRepository {
  return {
    async create(input: NewTaskInput): Promise<Task> {
      const res = await query<TaskRow>(
        `INSERT INTO tasks (session_id, user_id, profile, goal, max_steps, kind)
              VALUES ($1, $2, $3, $4, COALESCE($5, 25), COALESCE($6, 'agent'))
         RETURNING ${TASK_COLS}`,
        [
          input.sessionId,
          input.userId,
          input.profile,
          input.goal,
          input.maxSteps ?? null,
          input.kind ?? null,
        ],
      );
      const row = res.rows[0];
      if (!row) throw new Error('INSERT em tasks não devolveu linha.');
      return mapTaskRow(row);
    },

    async findById(id: string): Promise<Task | null> {
      const res = await query<TaskRow>(`SELECT ${TASK_COLS} FROM tasks WHERE id = $1`, [id]);
      const row = res.rows[0];
      return row ? mapTaskRow(row) : null;
    },

    async listByUser(userId: number, opts: ListTasksOpts = {}): Promise<Task[]> {
      // `kinds` ausente = todos. A resolução por prefixo precisa enxergar turnos
      // de chat também, senão `nio task show <id-de-turno>` não acharia nada.
      const kinds = opts.kinds;
      // Paginado por padrão (regra do harness: nunca coleção ilimitada).
      const res = await query<TaskRow>(
        `SELECT ${TASK_COLS} FROM tasks
          WHERE user_id = $1
            AND ($4::text[] IS NULL OR kind = ANY($4::text[]))
          ORDER BY created_at DESC
          LIMIT $2 OFFSET $3`,
        [
          userId,
          Math.min(Math.max(1, opts.limit ?? 50), 200),
          Math.max(0, opts.offset ?? 0),
          kinds && kinds.length > 0 ? [...kinds] : null,
        ],
      );
      return res.rows.map(mapTaskRow);
    },

    async setStatus(id, status, fence, patch = {}): Promise<boolean> {
      const extra = patchClauses(patch, 4);
      const res = await query(
        `UPDATE tasks SET status = $2${extra.sql.length ? ', ' + extra.sql.join(', ') : ''}
          WHERE id = $1 AND fence = $3`,
        [id, status, fence, ...extra.values],
      );
      return (res.rowCount ?? 0) > 0;
    },

    async complete(id: string, fence: number, result: string): Promise<boolean> {
      const res = await query(
        `UPDATE tasks
            SET status = 'completed', result = $3, completed_at = now(),
                locked_by = NULL, locked_at = NULL
          WHERE id = $1 AND fence = $2`,
        [id, fence, result],
      );
      return (res.rowCount ?? 0) > 0;
    },

    async fail(id: string, fence: number, error: string): Promise<boolean> {
      const res = await query(
        `UPDATE tasks
            SET status = 'failed', error = $3, attempts = attempts + 1,
                completed_at = now(), locked_by = NULL, locked_at = NULL
          WHERE id = $1 AND fence = $2`,
        [id, fence, error],
      );
      return (res.rowCount ?? 0) > 0;
    },

    async approve(id: string, userId: number, tool: string): Promise<boolean> {
      // Concessão acumula sem repetir e a task volta pra fila no MESMO passo —
      // duas escritas separadas abririam janela pro worker reivindicar a task
      // ainda sem a permissão e estacioná-la de novo.
      const res = await query(
        `UPDATE tasks
            SET approved_tools = (
                  SELECT COALESCE(jsonb_agg(DISTINCT valor), '[]'::jsonb)
                    FROM jsonb_array_elements_text(approved_tools || to_jsonb($3::text)) AS valor
                ),
                awaiting_kind = NULL,
                awaiting_subject = NULL,
                status = 'pending',
                locked_by = NULL,
                locked_at = NULL
          WHERE id = $1 AND user_id = $2 AND status = 'waiting_approval'`,
        [id, userId, tool],
      );
      return (res.rowCount ?? 0) > 0;
    },

    async cancel(id: string, userId: number): Promise<boolean> {
      // Sem `fence`: cancelar é do dono, não do worker. Task já encerrada não volta.
      const res = await query(
        `UPDATE tasks
            SET status = 'cancelled', completed_at = now(),
                locked_by = NULL, locked_at = NULL
          WHERE id = $1 AND user_id = $2
            AND status NOT IN ('completed', 'failed', 'cancelled')`,
        [id, userId],
      );
      return (res.rowCount ?? 0) > 0;
    },
  };
}
