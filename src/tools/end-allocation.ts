import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext } from './index.js';
import { jsonResult, errorResult } from '../lib/tool-result.js';
import { durationSeconds } from '../lib/duration.js';
import { brand } from '../brand.js';

export const definition: Tool = {
  name: `${brand.toolPrefix}end_allocation`,
  description:
    '[ENCERRA O DIA] Bate ponto de SAÍDA do usuário e fecha qualquer task_allocation aberta. ' +
    '⚠️ Use SOMENTE quando o usuário indicar explicitamente fim de expediente ' +
    '("encerrar dia", "bati ponto", "saí"). Para parar APENAS o timer de uma task ' +
    `sem encerrar o dia, use \`${brand.toolPrefix}end_task_allocation\`.`,
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
};

/** Monta o payload de resposta do end_allocation. Pura. */
export function formatEndAllocationResult(
  closed: { id: string; start_time: string; end_time: string | null },
  closedTaskAllocationsCount: number,
): Record<string, unknown> {
  return {
    allocation_id: closed.id,
    start_time: closed.start_time,
    end_time: closed.end_time,
    duration_seconds: durationSeconds(closed.start_time, closed.end_time),
    closed_task_allocations: closedTaskAllocationsCount,
  };
}

export async function handler(_args: unknown, ctx: ToolContext): Promise<CallToolResult> {
  let result;
  try {
    result = await ctx.gateway.endAllocation(ctx.user.id);
  } catch (err) {
    return errorResult((err as Error).message);
  }
  if (!result) return errorResult('Não há alocação ativa para encerrar.');
  return jsonResult(formatEndAllocationResult(result.closed, result.closedTaskAllocations));
}
