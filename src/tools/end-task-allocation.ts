import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext } from './index.js';
import { jsonResult, errorResult } from '../lib/tool-result.js';
import { durationSeconds } from '../lib/duration.js';
import { brand } from '../brand.js';

export const definition: Tool = {
  name: `${brand.toolPrefix}end_task_allocation`,
  description:
    '[PARA TIMER DE TASK] Para a task_allocation ativa. A alocação principal (ponto do dia) ' +
    'CONTINUA aberta. Use ao finalizar ou pausar uma task. ' +
    `Para encerrar o dia inteiro, use \`${brand.toolPrefix}end_allocation\`.`,
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
};

/** Monta o payload de resposta do end_task_allocation. Pura. */
export function formatEndTaskAllocationResult(
  closed: { id: string; start_time: string; end_time: string | null },
  task: { id: string; key: string | null; title: string | null },
): Record<string, unknown> {
  return {
    task_allocation_id: closed.id,
    task,
    start_time: closed.start_time,
    end_time: closed.end_time,
    duration_seconds: durationSeconds(closed.start_time, closed.end_time),
  };
}

export async function handler(_args: unknown, ctx: ToolContext): Promise<CallToolResult> {
  let result;
  try {
    result = await ctx.gateway.endTaskAllocation(ctx.user.id);
  } catch (err) {
    return errorResult((err as Error).message);
  }
  if (!result) return errorResult('Não há task_allocation ativa.');
  return jsonResult(formatEndTaskAllocationResult(result.closed, result.task));
}
