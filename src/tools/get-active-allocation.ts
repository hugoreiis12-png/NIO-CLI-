import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext } from './index.js';
import { jsonResult, errorResult } from '../lib/tool-result.js';
import { durationSeconds } from '../lib/duration.js';
import { brand } from '../brand.js';

export const definition: Tool = {
  name: `${brand.toolPrefix}get_active_allocation`,
  description:
    'Retorna o estado atual de cronometragem do usuário: alocação ativa, task atual sendo ' +
    'cronometrada, e segmentos por task na alocação atual.',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
};

type TaskInfoRef = { key: string; title: string; project_id: string };
type SegmentRow = { id: string; task_id: string; start_time: string; end_time: string | null; is_overtime: boolean };

function taskInfoLookup(tasksById: Map<string, TaskInfoRef>, projectsById: Map<string, string>) {
  return (taskId: string) => {
    const t = tasksById.get(taskId);
    return {
      id: taskId,
      key: t?.key ?? null,
      title: t?.title ?? null,
      project_name: t ? projectsById.get(t.project_id) ?? null : null,
    };
  };
}

/** Monta a resposta de alocação ativa: allocation, task ativa, segmentos e total do dia. Pura. */
export function formatActiveAllocation(
  allocation: { id: string; start_time: string },
  segmentRows: SegmentRow[],
  tasksById: Map<string, TaskInfoRef>,
  projectsById: Map<string, string>,
): Record<string, unknown> {
  const taskInfo = taskInfoLookup(tasksById, projectsById);

  const segments = segmentRows.map((s) => ({
    task_allocation_id: s.id,
    task: taskInfo(s.task_id),
    start_time: s.start_time,
    end_time: s.end_time,
    duration_seconds: durationSeconds(s.start_time, s.end_time),
    is_overtime: s.is_overtime,
  }));

  const activeSegment = segmentRows.find((s) => s.end_time === null);
  const activeTask = activeSegment
    ? {
        task_allocation_id: activeSegment.id,
        task: taskInfo(activeSegment.task_id),
        start_time: activeSegment.start_time,
        elapsed_seconds: durationSeconds(activeSegment.start_time, null),
        is_overtime: activeSegment.is_overtime,
      }
    : null;

  return {
    allocation: {
      id: allocation.id,
      start_time: allocation.start_time,
      elapsed_seconds: durationSeconds(allocation.start_time, null),
    },
    active_task: activeTask,
    segments,
    total_seconds_today: segments.reduce((acc, s) => acc + s.duration_seconds, 0),
  };
}

export async function handler(_args: unknown, ctx: ToolContext): Promise<CallToolResult> {
  let data;
  try {
    data = await ctx.gateway.getActiveAllocation(ctx.user.id);
  } catch (err) {
    return errorResult((err as Error).message);
  }
  if (!data) return jsonResult({ allocation: null, active_task: null, segments: [], total_seconds_today: 0 });
  return jsonResult(
    formatActiveAllocation(data.allocation, data.segments, data.tasksById, data.projectsById),
  );
}
