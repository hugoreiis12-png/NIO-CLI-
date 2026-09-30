/**
 * Implementação Postgres do `StepRepository` (port em `core/tasks.ts`).
 *
 * A trilha é append-only por tentativa: `retry` insere `(step_number, attempt+1)`
 * em vez de sobrescrever, porque o que falhou na tentativa 1 é a informação mais
 * valiosa da execução — é dela que sai a lição em `agent_lesson`.
 */
import type { StepStatus } from '../../core/types.js';
import type {
  NewStepInput,
  StepRepository,
  StepResult,
  TaskStep,
  ToolCallTrace,
} from '../../core/tasks.js';
import { query, withTransaction } from './client.js';

interface StepRow {
  id: string; // BIGSERIAL vem como string no pg
  task_id: string;
  step_number: number;
  attempt: number;
  name: string;
  status: StepStatus;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  tool_calls: ToolCallTrace[] | null;
  tokens_in: number | null;
  tokens_out: number | null;
  error: string | null;
  started_at: Date | null;
  completed_at: Date | null;
}

const STEP_COLS = `id, task_id, step_number, attempt, name, status, input, output,
  tool_calls, tokens_in, tokens_out, error, started_at, completed_at`;

function mapStepRow(row: StepRow): TaskStep {
  return {
    id: Number(row.id),
    taskId: row.task_id,
    stepNumber: row.step_number,
    attempt: row.attempt,
    name: row.name,
    status: row.status,
    input: row.input,
    output: row.output,
    toolCalls: row.tool_calls,
    tokensIn: row.tokens_in,
    tokensOut: row.tokens_out,
    error: row.error,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

/** Insere um lote de steps no mesmo client — usado dentro de transação. */
async function insertBatch(
  run: typeof query,
  taskId: string,
  steps: readonly NewStepInput[],
): Promise<TaskStep[]> {
  const out: TaskStep[] = [];
  for (const step of steps) {
    const res = await run<StepRow>(
      `INSERT INTO task_steps (task_id, step_number, name, input)
            VALUES ($1, $2, $3, $4::jsonb)
       RETURNING ${STEP_COLS}`,
      [taskId, step.stepNumber, step.name, JSON.stringify(step.input ?? null)],
    );
    const row = res.rows[0];
    if (!row) throw new Error(`INSERT do step ${step.stepNumber} não devolveu linha.`);
    out.push(mapStepRow(row));
  }
  return out;
}

export function createStepRepository(): StepRepository {
  return {
    async insertAll(taskId: string, steps: readonly NewStepInput[]): Promise<TaskStep[]> {
      if (steps.length === 0) return [];
      // Plano pela metade não existe: ou entram todos os steps, ou nenhum.
      return withTransaction((client) =>
        insertBatch((text, params) => client.query(text, params ? [...params] : undefined), taskId, steps),
      );
    },

    async listByTask(taskId: string): Promise<TaskStep[]> {
      const res = await query<StepRow>(
        `SELECT ${STEP_COLS} FROM task_steps
          WHERE task_id = $1 ORDER BY step_number, attempt`,
        [taskId],
      );
      return res.rows.map(mapStepRow);
    },

    async nextPending(taskId: string): Promise<TaskStep | null> {
      const res = await query<StepRow>(
        `SELECT ${STEP_COLS} FROM task_steps
          WHERE task_id = $1 AND status = 'pending'
          ORDER BY step_number, attempt
          LIMIT 1`,
        [taskId],
      );
      const row = res.rows[0];
      return row ? mapStepRow(row) : null;
    },

    async start(stepId: number): Promise<void> {
      await query(
        `UPDATE task_steps SET status = 'running', started_at = now() WHERE id = $1`,
        [stepId],
      );
    },

    async reopen(stepId: number): Promise<void> {
      // Limpa `started_at` junto: o step vai ser executado de novo do zero, e
      // deixar a marca antiga faria a duração medida virar ficção.
      await query(
        `UPDATE task_steps SET status = 'pending', started_at = NULL
          WHERE id = $1 AND status = 'running'`,
        [stepId],
      );
    },

    async finish(stepId: number, result: StepResult): Promise<void> {
      await query(
        `UPDATE task_steps
            SET status = 'done', output = $2::jsonb, tool_calls = $3::jsonb,
                tokens_in = $4, tokens_out = $5, completed_at = now()
          WHERE id = $1`,
        [
          stepId,
          JSON.stringify(result.output),
          JSON.stringify(result.toolCalls ?? []),
          result.tokensIn ?? null,
          result.tokensOut ?? null,
        ],
      );
    },

    async failStep(stepId: number, error: string): Promise<void> {
      await query(
        `UPDATE task_steps SET status = 'failed', error = $2, completed_at = now() WHERE id = $1`,
        [stepId, error],
      );
    },

    async retry(stepId: number): Promise<TaskStep> {
      // Nova linha com `attempt + 1` — a tentativa anterior fica no histórico.
      const res = await query<StepRow>(
        `INSERT INTO task_steps (task_id, step_number, attempt, name, input)
              SELECT task_id, step_number, attempt + 1, name, input
                FROM task_steps WHERE id = $1
         RETURNING ${STEP_COLS}`,
        [stepId],
      );
      const row = res.rows[0];
      if (!row) throw new Error(`Step ${stepId} não encontrado para retry.`);
      return mapStepRow(row);
    },

    async append(taskId: string, steps: readonly NewStepInput[]): Promise<TaskStep[]> {
      if (steps.length === 0) return [];
      return withTransaction((client) =>
        insertBatch((text, params) => client.query(text, params ? [...params] : undefined), taskId, steps),
      );
    },

    async lastStepNumber(taskId: string): Promise<number> {
      const res = await query<{ max: number | null }>(
        `SELECT MAX(step_number) AS max FROM task_steps WHERE task_id = $1`,
        [taskId],
      );
      return res.rows[0]?.max ?? 0;
    },
  };
}
