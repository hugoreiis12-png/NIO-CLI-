import { z } from 'zod';
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext } from './index.js';
import { jsonResult, errorResult } from '../lib/tool-result.js';
import { resolveProjectConfig, isErrorResult } from '../lib/require-config.js';
import { durationSeconds } from '../lib/duration.js';
import { brand } from '../brand.js';

const ArgsSchema = z
  .object({
    task_id: z.uuid(),
    is_overtime: z.boolean().default(false),
    project_id: z.uuid().optional(),
  })
  .strict();

export const definition: Tool = {
  name: `${brand.toolPrefix}start_task_allocation`,
  description:
    'Começa a cronometrar tempo numa task específica. Se não há alocação ativa (ponto do dia), ' +
    'abre uma. Se já existe outra task_allocation ativa, fecha ela e abre essa — ' +
    'transição entre tasks é atômica, basta chamar isso na próxima task.',
  inputSchema: {
    type: 'object',
    properties: {
      task_id: { type: 'string', format: 'uuid' },
      is_overtime: { type: 'boolean', default: false },
      project_id: {
        type: 'string',
        format: 'uuid',
        description: `Override do projeto. Se omitido, usa o projeto ativo (${brand.toolPrefix}set_project) ou o default.`,
      },
    },
    required: ['task_id'],
    additionalProperties: false,
  },
};

type ClosedPreviousSummary = {
  task_allocation_id: string;
  task_id: string;
  task_key: string | null;
  duration_seconds: number;
};

/** Monta o resumo da task_allocation anterior fechada, calculando a duração. Pura. */
export function buildClosedPreviousSummary(
  prev: { id: string; task_id: string },
  closed: { start_time: string; end_time: string | null },
  prevTaskKey: string | null,
): ClosedPreviousSummary {
  return {
    task_allocation_id: prev.id,
    task_id: prev.task_id,
    task_key: prevTaskKey,
    duration_seconds: durationSeconds(closed.start_time, closed.end_time),
  };
}

/** Monta o payload de resposta do start_task_allocation. Pura. */
export function formatStartTaskAllocationResult(
  taskAllocation: { id: string; start_time: string; is_overtime: boolean },
  task: { id: string; key: string; title: string },
  closedPrevious: ClosedPreviousSummary | null,
  allocationWasCreated: boolean,
): Record<string, unknown> {
  return {
    task_allocation_id: taskAllocation.id,
    task: { id: task.id, key: task.key, title: task.title },
    started_at: taskAllocation.start_time,
    is_overtime: taskAllocation.is_overtime,
    closed_previous: closedPrevious,
    allocation_was_created: allocationWasCreated,
  };
}

export async function handler(args: unknown, ctx: ToolContext): Promise<CallToolResult> {
  const parsed = ArgsSchema.safeParse(args);
  if (!parsed.success) return errorResult(`Argumento inválido: ${parsed.error.message}`);
  const { task_id, is_overtime } = parsed.data;
  const cfg = resolveProjectConfig(ctx, parsed.data.project_id);
  if (isErrorResult(cfg)) return cfg;

  let data;
  try {
    data = await ctx.gateway.startTaskAllocation(task_id, cfg.project_id, ctx.user.id, is_overtime);
  } catch (err) {
    return errorResult((err as Error).message);
  }
  if (!data) return errorResult('Tarefa não encontrada ou fora do projeto vinculado a este diretório.');

  const closedPrevious = data.previousClosed
    ? buildClosedPreviousSummary(
        data.previousClosed.prev,
        data.previousClosed.closed,
        data.previousClosed.prevTaskKey,
      )
    : null;
  return jsonResult(
    formatStartTaskAllocationResult(data.taskAllocation, data.task, closedPrevious, data.allocationWasCreated),
  );
}
