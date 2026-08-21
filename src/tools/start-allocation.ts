import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext } from './index.js';
import { jsonResult, errorResult } from '../lib/tool-result.js';
import { durationSeconds } from '../lib/duration.js';
import { brand } from '../brand.js';

export const definition: Tool = {
  name: `${brand.toolPrefix}start_allocation`,
  description:
    'Inicia uma alocação (bate o ponto) para o usuário atual. Se já existe uma alocação ' +
    'ativa, retorna ela sem criar duplicada.',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
};

/** Monta o payload de status de alocação (nova ou já ativa). Pura. */
export function formatAllocationStatus(
  row: { id: string; start_time: string },
  alreadyActive: boolean,
): Record<string, unknown> {
  return {
    allocation_id: row.id,
    start_time: row.start_time,
    elapsed_seconds: durationSeconds(row.start_time, null),
    already_active: alreadyActive,
  };
}

export async function handler(_args: unknown, ctx: ToolContext): Promise<CallToolResult> {
  try {
    const { allocation, alreadyActive } = await ctx.gateway.startAllocation(ctx.user.id);
    return jsonResult(formatAllocationStatus(allocation, alreadyActive));
  } catch (err) {
    return errorResult((err as Error).message);
  }
}
