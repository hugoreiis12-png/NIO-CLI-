import { z } from 'zod';
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext } from './index.js';
import type { Database } from '../database.types.js';
import type { UpdatedTaskRow } from '../core/types.js';
import { jsonResult, errorResult } from '../lib/tool-result.js';
import { resolveProjectConfig, isErrorResult } from '../lib/require-config.js';
import { brand } from '../brand.js';

type TaskUpdate = Database['public']['Tables']['tasks']['Update'];

const TASK_STATUS = [
  'backlog',
  'todo',
  'doing',
  'code_review',
  'rejected',
  'qa',
  'done',
  'production',
] as const;
const TASK_PRIORITY = ['none', 'lowest', 'low', 'medium', 'high', 'urgent'] as const;
const TASK_TYPE = ['story', 'bug', 'task', 'epic', 'subtask', 'meeting'] as const;

const ArgsSchema = z
  .object({
    task_id: z.uuid(),
    title: z.string().min(1).max(200).optional(),
    description: z.string().optional(),
    priority: z.enum(TASK_PRIORITY).optional(),
    type: z.enum(TASK_TYPE).optional(),
    status: z.enum(TASK_STATUS).optional(),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    sprint: z.string().optional(),
    assignee_user_ids: z.array(z.uuid()).optional(),
    label_ids: z.array(z.uuid()).optional(),
    project_id: z.uuid().optional(),
  })
  .strict();

export const definition: Tool = {
  name: `${brand.toolPrefix}update_task`,
  description:
    'Atualiza campos de uma tarefa existente. Só passe os campos que quer mudar. ' +
    'assignee_user_ids e label_ids são *substituições completas* — passar [] remove todos.',
  inputSchema: {
    type: 'object',
    properties: {
      task_id: { type: 'string', format: 'uuid' },
      title: { type: 'string', minLength: 1, maxLength: 200 },
      description: { type: 'string' },
      priority: { type: 'string', enum: [...TASK_PRIORITY] },
      type: { type: 'string', enum: [...TASK_TYPE] },
      status: { type: 'string', enum: [...TASK_STATUS] },
      end_date: { type: ['string', 'null'], description: 'Data ISO YYYY-MM-DD ou null pra remover.' },
      sprint: { type: 'string', description: '"active", "none" ou UUID.' },
      assignee_user_ids: { type: 'array', items: { type: 'string', format: 'uuid' } },
      label_ids: { type: 'array', items: { type: 'string', format: 'uuid' } },
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

type FieldChange = { field: string; old_value: string | null; new_value: string | null };

type CurrentTask = {
  title: string; description: string | null; status: string; priority: string;
  type: string; sprint_id: string | null; end_date: string | null;
};

type UpdateInput = Pick<
  z.infer<typeof ArgsSchema>,
  'title' | 'description' | 'status' | 'priority' | 'type' | 'end_date'
>;

const SCALAR_PATCH_FIELDS = ['title', 'description', 'status', 'priority', 'type', 'end_date'] as const;

function toHistoryValue(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}

/** Diff entre a task atual e o input: patch a aplicar + changes pro history. Pura. */
export function buildTaskPatch(
  current: CurrentTask,
  input: UpdateInput,
  nextSprintId: string | null | undefined,
): { patch: TaskUpdate; changes: FieldChange[] } {
  const patch: Record<string, unknown> = {};
  const changes: FieldChange[] = [];

  for (const field of SCALAR_PATCH_FIELDS) {
    const nextVal = input[field];
    const curVal = current[field];
    if (nextVal !== undefined && nextVal !== curVal) {
      patch[field] = nextVal;
      changes.push({ field, old_value: toHistoryValue(curVal), new_value: toHistoryValue(nextVal) });
    }
  }
  if (nextSprintId !== undefined && nextSprintId !== current.sprint_id) {
    patch.sprint_id = nextSprintId;
    changes.push({
      field: 'sprint_id',
      old_value: toHistoryValue(current.sprint_id),
      new_value: toHistoryValue(nextSprintId),
    });
  }

  return { patch: patch as TaskUpdate, changes };
}

/** Compara conjunto atual vs novo de ids (assignees ou labels): já ordenados + flag de mudança. Pura. */
export function diffIdSet(
  currentIds: string[],
  nextIds: string[],
): { before: string[]; after: string[]; changed: boolean } {
  const before = [...currentIds].sort();
  const after = [...nextIds].sort();
  const changed = !(before.length === after.length && before.every((v, i) => v === after[i]));
  return { before, after, changed };
}

/** Monta o payload de resposta a partir da task recarregada + mudanças aplicadas. Pura. */
export function buildUpdateTaskResult(
  finalTask: UpdatedTaskRow,
  changes: FieldChange[],
  input: { assignee_user_ids?: string[]; label_ids?: string[] },
): Record<string, unknown> {
  return {
    ...finalTask,
    changed_fields: changes.map((c) => c.field),
    assignees_changed: input.assignee_user_ids !== undefined,
    labels_changed: input.label_ids !== undefined,
  };
}

export async function handler(args: unknown, ctx: ToolContext): Promise<CallToolResult> {
  const parsed = ArgsSchema.safeParse(args);
  if (!parsed.success) return errorResult(`Argumento inválido: ${parsed.error.message}`);
  const input = parsed.data;
  const cfg = resolveProjectConfig(ctx, input.project_id);
  if (isErrorResult(cfg)) return cfg;

  try {
    const current = await ctx.gateway.getCurrentTask(input.task_id, cfg.project_id);
    if (!current) return errorResult('Tarefa não encontrada ou fora do projeto atual.');
    const nextSprintId = await ctx.gateway.resolveNextSprintId(cfg.project_id, input.sprint);

    const { patch, changes } = buildTaskPatch(current, input, nextSprintId);
    await ctx.gateway.applyTaskPatch(input.task_id, cfg.project_id, ctx.user.id, patch, changes);

    // assignees/labels são substituições completas — comparamos no client (diffIdSet)
    // e só reescrevemos se mudou.
    if (input.assignee_user_ids !== undefined) {
      const currentIds = await ctx.gateway.getTaskIdSet('assignees', input.task_id);
      const { before, after, changed } = diffIdSet(currentIds, input.assignee_user_ids);
      if (changed) {
        await ctx.gateway.replaceTaskIdSet('assignees', input.task_id, ctx.user.id, input.assignee_user_ids, before, after);
      }
    }
    if (input.label_ids !== undefined) {
      const currentIds = await ctx.gateway.getTaskIdSet('labels', input.task_id);
      const { before, after, changed } = diffIdSet(currentIds, input.label_ids);
      if (changed) {
        await ctx.gateway.replaceTaskIdSet('labels', input.task_id, ctx.user.id, input.label_ids, before, after);
      }
    }

    const finalTask = await ctx.gateway.reloadTask(input.task_id);
    return jsonResult(buildUpdateTaskResult(finalTask, changes, input));
  } catch (err) {
    return errorResult((err as Error).message);
  }
}
