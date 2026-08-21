import { z } from 'zod';
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext } from './index.js';
import { jsonResult, errorResult } from '../lib/tool-result.js';
import { durationSeconds } from '../lib/duration.js';
import { brand } from '../brand.js';

const ArgsSchema = z
  .object({
    limit: z.number().int().min(1).max(50).default(10),
    offset: z.number().int().min(0).default(0),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
  })
  .strict();

export const definition: Tool = {
  name: `${brand.toolPrefix}list_my_allocations`,
  description:
    'Lista alocações passadas do usuário (encerradas), ordenadas por data decrescente. ' +
    'Útil pra revisar histórico de ponto.',
  inputSchema: {
    type: 'object',
    properties: {
      limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
      offset: { type: 'integer', minimum: 0, default: 0 },
      from: { type: 'string', description: 'ISO date (YYYY-MM-DD), inclusive.' },
      to: { type: 'string', description: 'ISO date (YYYY-MM-DD), inclusive.' },
    },
    additionalProperties: false,
  },
};

type AllocationRow = { id: string; start_time: string; end_time: string | null; auto_closed: boolean };
type SegmentRow = { allocation_id: string; start_time: string; end_time: string | null };

/** Agrega segmentos (task_allocations) por allocation: contagem + segundos rastreados. Pura. */
export function aggregateSegmentsByAllocation(segRows: SegmentRow[]): Map<string, { count: number; tracked_seconds: number }> {
  const aggByAlloc = new Map<string, { count: number; tracked_seconds: number }>();
  for (const s of segRows) {
    const agg = aggByAlloc.get(s.allocation_id) ?? { count: 0, tracked_seconds: 0 };
    agg.count += 1;
    agg.tracked_seconds += durationSeconds(s.start_time, s.end_time);
    aggByAlloc.set(s.allocation_id, agg);
  }
  return aggByAlloc;
}

/** Monta a lista de alocações com duração + agregados de segmentos embutidos. Pura. */
export function formatAllocationList(
  allocations: AllocationRow[],
  aggByAlloc: Map<string, { count: number; tracked_seconds: number }>,
): Array<Record<string, unknown>> {
  return allocations.map((a) => {
    const agg = aggByAlloc.get(a.id) ?? { count: 0, tracked_seconds: 0 };
    return {
      id: a.id,
      start_time: a.start_time,
      end_time: a.end_time,
      duration_seconds: durationSeconds(a.start_time, a.end_time),
      auto_closed: a.auto_closed,
      task_count: agg.count,
      tracked_seconds: agg.tracked_seconds,
    };
  });
}

export async function handler(args: unknown, ctx: ToolContext): Promise<CallToolResult> {
  const parsed = ArgsSchema.safeParse(args);
  if (!parsed.success) return errorResult(`Argumento inválido: ${parsed.error.message}`);
  const input = parsed.data;

  let data;
  try {
    data = await ctx.gateway.listMyAllocations(ctx.user.id, input);
  } catch (err) {
    return errorResult((err as Error).message);
  }
  if (data.allocations.length === 0) return jsonResult({ allocations: [], has_more: false });

  const result = formatAllocationList(data.allocations, aggregateSegmentsByAllocation(data.segments));
  return jsonResult({ allocations: result, has_more: result.length === input.limit, limit: input.limit, offset: input.offset });
}
