import { z } from 'zod';
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext } from './index.js';
import { jsonResult, errorResult } from '../lib/tool-result.js';
import { resolveProjectConfig, isErrorResult } from '../lib/require-config.js';
import { brand } from '../brand.js';

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
    status: z.array(z.enum(TASK_STATUS)).optional(),
    assignee: z.string().optional(),
    sprint: z.string().optional(),
    priority: z.array(z.enum(TASK_PRIORITY)).optional(),
    type: z.array(z.enum(TASK_TYPE)).optional(),
    search: z.string().min(1).max(200).optional(),
    limit: z.number().int().min(1).max(200).default(50),
    offset: z.number().int().min(0).default(0),
    project_id: z.uuid().optional(),
  })
  .strict();

export const definition: Tool = {
  name: `${brand.toolPrefix}list_tasks`,
  description:
    'Lista tarefas do projeto atual, filtradas pelos parâmetros opcionais. ' +
    'Sem filtros, retorna até 50 tarefas mais recentes.',
  inputSchema: {
    type: 'object',
    properties: {
      status: { type: 'array', items: { type: 'string', enum: [...TASK_STATUS] } },
      assignee: {
        type: 'string',
        description: '"me", "unassigned", ou UUID de um usuário.',
      },
      sprint: {
        type: 'string',
        description: '"active", "none", ou UUID de uma sprint.',
      },
      priority: { type: 'array', items: { type: 'string', enum: [...TASK_PRIORITY] } },
      type: { type: 'array', items: { type: 'string', enum: [...TASK_TYPE] } },
      search: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
      offset: { type: 'integer', minimum: 0, default: 0 },
      project_id: {
        type: 'string',
        format: 'uuid',
        description: `Override do projeto. Se omitido, usa o projeto ativo (${brand.toolPrefix}set_project) ou o default.`,
      },
    },
    additionalProperties: false,
  },
};

export async function handler(args: unknown, ctx: ToolContext): Promise<CallToolResult> {
  const parsed = ArgsSchema.safeParse(args);
  if (!parsed.success) return errorResult(`Argumento inválido: ${parsed.error.message}`);
  const input = parsed.data;
  const cfg = resolveProjectConfig(ctx, input.project_id);
  if (isErrorResult(cfg)) return cfg;

  try {
    const { tasks, note } = await ctx.gateway.listTasks({
      projectId: cfg.project_id,
      userId: ctx.user.id,
      status: input.status,
      priority: input.priority,
      type: input.type,
      search: input.search,
      assignee: input.assignee,
      sprint: input.sprint,
      limit: input.limit,
      offset: input.offset,
    });
    return jsonResult({
      tasks,
      count: tasks.length,
      limit: input.limit,
      offset: input.offset,
      ...(note ? { note } : {}),
    });
  } catch (err) {
    return errorResult((err as Error).message);
  }
}
