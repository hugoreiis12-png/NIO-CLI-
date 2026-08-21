import { z } from 'zod';
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext } from './index.js';
import type { Database } from '../database.types.js';
import type { CreatedTaskRow } from '../core/types.js';
import { jsonResult, errorResult } from '../lib/tool-result.js';
import { resolveProjectConfig, isErrorResult } from '../lib/require-config.js';
import { brand } from '../brand.js';

type TaskInsert = Database['public']['Tables']['tasks']['Insert'];

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
    title: z.string().min(1).max(200),
    description: z.string().default(''),
    priority: z.enum(TASK_PRIORITY).default('none'),
    type: z.enum(TASK_TYPE).default('task'),
    status: z.enum(TASK_STATUS).default('todo'),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    sprint: z.string().default('active'),
    assignee_user_ids: z.array(z.uuid()).optional(),
    label_ids: z.array(z.uuid()).optional(),
    link_to_current_repository: z.boolean().default(true),
    additional_repository_ids: z.array(z.uuid()).optional(),
    project_id: z.uuid().optional(),
  })
  .strict();

export const definition: Tool = {
  name: `${brand.toolPrefix}create_task`,
  description:
    'Cria uma nova tarefa no projeto atual. Por padrão: status=todo, sprint=active, ' +
    'type=task, assignee=você. Pra colocar no backlog fora de sprint, passe ' +
    'status="backlog" e sprint="none". O reporter é sempre o usuário autenticado.',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 200 },
      description: { type: 'string' },
      priority: { type: 'string', enum: [...TASK_PRIORITY] },
      type: { type: 'string', enum: [...TASK_TYPE] },
      status: { type: 'string', enum: [...TASK_STATUS] },
      end_date: { type: 'string', description: 'Data ISO (YYYY-MM-DD).' },
      sprint: {
        type: 'string',
        description: '"active", "none" ou UUID. Default "none".',
      },
      assignee_user_ids: { type: 'array', items: { type: 'string', format: 'uuid' } },
      label_ids: { type: 'array', items: { type: 'string', format: 'uuid' } },
      link_to_current_repository: {
        type: 'boolean',
        description: `Vincula automaticamente ao repositório do ${brand.projectConfigFile}. Default true.`,
      },
      additional_repository_ids: { type: 'array', items: { type: 'string', format: 'uuid' } },
      project_id: {
        type: 'string',
        format: 'uuid',
        description: `Override do projeto. Se omitido, usa o projeto ativo (${brand.toolPrefix}set_project) ou o default.`,
      },
    },
    required: ['title'],
    additionalProperties: false,
  },
};

type CreateTaskInput = z.infer<typeof ArgsSchema>;

/** Resolve assignees (default: o próprio usuário) e a lista deduplicada de repositórios a vincular. Pura. */
export function resolveTaskLinks(
  input: Pick<CreateTaskInput, 'assignee_user_ids' | 'link_to_current_repository' | 'additional_repository_ids'>,
  repositoryId: string | null | undefined,
  userId: string,
): { assigneeIds: string[]; repoIds: string[] } {
  const assigneeIds = input.assignee_user_ids ?? [userId];
  const repoIds: string[] = [];
  if (input.link_to_current_repository && repositoryId) repoIds.push(repositoryId);
  for (const r of input.additional_repository_ids ?? []) {
    if (!repoIds.includes(r)) repoIds.push(r);
  }
  return { assigneeIds, repoIds };
}

/** Monta o payload de insert da task a partir do input + sprint já resolvida. Pura. */
export function buildTaskInsertPayload(
  input: Pick<CreateTaskInput, 'title' | 'description' | 'status' | 'priority' | 'type' | 'end_date'>,
  projectId: string,
  reporterId: string,
  sprintId: string | null,
): TaskInsert {
  return {
    title: input.title,
    description: input.description,
    status: input.status,
    priority: input.priority,
    type: input.type,
    project_id: projectId,
    reporter_id: reporterId,
    sprint_id: sprintId,
    end_date: input.end_date ?? null,
  };
}

/** Monta o payload de resposta a partir da task criada + vínculos + warnings. Pura. */
export function buildCreateTaskResult(
  task: CreatedTaskRow,
  assigneeIds: string[],
  labelIds: string[],
  repoIds: string[],
  warnings: string[],
): Record<string, unknown> {
  return {
    id: task.id,
    key: task.key,
    title: task.title,
    status: task.status,
    priority: task.priority,
    type: task.type,
    sprint_id: task.sprint_id,
    end_date: task.end_date,
    created_at: task.created_at,
    linked: { assignee_user_ids: assigneeIds, label_ids: labelIds, repository_ids: repoIds },
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

export async function handler(args: unknown, ctx: ToolContext): Promise<CallToolResult> {
  const parsed = ArgsSchema.safeParse(args);
  if (!parsed.success) return errorResult(`Argumento inválido: ${parsed.error.message}`);
  const input = parsed.data;
  const cfg = resolveProjectConfig(ctx, input.project_id);
  if (isErrorResult(cfg)) return cfg;

  try {
    const sprintId = await ctx.gateway.resolveSprintId(cfg.project_id, input.sprint);
    const payload = buildTaskInsertPayload(input, cfg.project_id, ctx.user.id, sprintId);
    const { assigneeIds, repoIds } = resolveTaskLinks(input, cfg.repository_id, ctx.user.id);
    const { task, warnings } = await ctx.gateway.createTask(
      payload,
      { assigneeIds, labelIds: input.label_ids ?? [], repoIds },
      ctx.user.id,
    );
    return jsonResult(buildCreateTaskResult(task, assigneeIds, input.label_ids ?? [], repoIds, warnings));
  } catch (err) {
    return errorResult((err as Error).message);
  }
}
