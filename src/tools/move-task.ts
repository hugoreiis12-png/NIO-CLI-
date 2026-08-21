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

const ArgsSchema = z
  .object({
    task_id: z.uuid(),
    status: z.enum(TASK_STATUS),
    project_id: z.uuid().optional(),
  })
  .strict();

export const definition: Tool = {
  name: `${brand.toolPrefix}move_task`,
  description:
    'Atalho pra mudar o status de uma tarefa (move entre colunas do Kanban). ' +
    `Equivale a \`${brand.toolPrefix}update_task\` passando só o campo status. ` +
    '⚠️ Mover para status terminal (done/qa/code_review/rejected/production) NÃO para o timer. ' +
    'Se há task_allocation ativa nessa task, pergunte ao usuário se quer encerrar o timer junto.',
  inputSchema: {
    type: 'object',
    properties: {
      task_id: { type: 'string', format: 'uuid' },
      status: { type: 'string', enum: [...TASK_STATUS] },
      project_id: {
        type: 'string',
        format: 'uuid',
        description: `Override do projeto. Se omitido, usa o projeto ativo (${brand.toolPrefix}set_project) ou o default.`,
      },
    },
    required: ['task_id', 'status'],
    additionalProperties: false,
  },
};

type CurrentTaskRef = { key: string; title: string; status: string };

/** Monta o payload de resposta do move_task, decidindo previous_status/already_in_status. Pura. */
export function buildMoveTaskResult(
  current: CurrentTaskRef,
  taskId: string,
  status: string,
): Record<string, unknown> {
  const alreadyInStatus = current.status === status;
  return {
    task_id: taskId,
    key: current.key,
    title: current.title,
    status,
    previous_status: alreadyInStatus ? status : current.status,
    already_in_status: alreadyInStatus,
  };
}

export async function handler(args: unknown, ctx: ToolContext): Promise<CallToolResult> {
  const parsed = ArgsSchema.safeParse(args);
  if (!parsed.success) return errorResult(`Argumento inválido: ${parsed.error.message}`);
  const { task_id, status } = parsed.data;
  const cfg = resolveProjectConfig(ctx, parsed.data.project_id);
  if (isErrorResult(cfg)) return cfg;

  let current;
  try {
    current = await ctx.gateway.getTaskForMove(task_id, cfg.project_id);
  } catch (err) {
    return errorResult((err as Error).message);
  }
  if (!current) return errorResult('Tarefa não encontrada ou fora do projeto atual.');
  if (current.status === status) return jsonResult(buildMoveTaskResult(current, task_id, status));

  try {
    await ctx.gateway.moveTaskStatus(task_id, cfg.project_id, status, ctx.user.id, current.status);
  } catch (err) {
    return errorResult((err as Error).message);
  }
  return jsonResult(buildMoveTaskResult(current, task_id, status));
}
