import { z } from 'zod';
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext } from './index.js';
import type { Database } from '../database.types.js';
import { jsonResult, errorResult } from '../lib/tool-result.js';
import { resolveProjectConfig, isErrorResult } from '../lib/require-config.js';
import type { TaskDetailProfile, TaskDetailRows, TaskDetailRefs } from '../core/types.js';
import { brand } from '../brand.js';

const ArgsSchema = z
  .object({
    task_id: z.uuid(),
    project_id: z.uuid().optional(),
  })
  .strict();

export const definition: Tool = {
  name: `${brand.toolPrefix}get_task`,
  description:
    'Retorna detalhes completos de uma tarefa: descrição, assignees, checklist, comentários, ' +
    'histórico recente, repositórios vinculados e labels.',
  inputSchema: {
    type: 'object',
    properties: {
      task_id: { type: 'string', format: 'uuid' },
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

type TaskRow = Database['public']['Tables']['tasks']['Row'];

/** Coleta os ids de usuário/repo/label referenciados pela task e suas relações. Pura. */
export function collectRelatedIds(
  task: { reporter_id: string },
  rows: TaskDetailRows,
): { userIds: string[]; repoIds: string[]; labelIds: string[] } {
  const userIds = new Set<string>();
  for (const r of rows.assigneeRows) userIds.add(r.user_id);
  for (const c of rows.commentRows) userIds.add(c.author_id);
  for (const h of rows.historyRows) userIds.add(h.user_id);
  userIds.add(task.reporter_id);
  return {
    userIds: Array.from(userIds),
    repoIds: rows.repoRows.map((r) => r.repository_id),
    labelIds: rows.labelRows.map((l) => l.label_id),
  };
}

function formatTaskCore(task: TaskRow, profiles: Map<string, TaskDetailProfile>): Record<string, unknown> {
  return {
    id: task.id,
    key: task.key,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    type: task.type,
    sprint_id: task.sprint_id,
    team: task.team,
    url: task.url,
    branch: task.branch,
    start_date: task.start_date,
    end_date: task.end_date,
    reporter: {
      user_id: task.reporter_id,
      full_name: profiles.get(task.reporter_id)?.full_name ?? null,
      username: profiles.get(task.reporter_id)?.username ?? null,
    },
    created_at: task.created_at,
    updated_at: task.updated_at,
  };
}

/** Monta o payload completo de detalhe da task a partir das linhas carregadas + refs resolvidas. Pura. */
export function formatTaskDetail(
  task: TaskRow,
  rows: TaskDetailRows,
  refs: TaskDetailRefs,
): Record<string, unknown> {
  return {
    task: formatTaskCore(task, refs.profiles),
    assignees: rows.assigneeRows.map((a) => ({
      user_id: a.user_id,
      full_name: refs.profiles.get(a.user_id)?.full_name ?? null,
      username: refs.profiles.get(a.user_id)?.username ?? null,
      avatar_url: refs.profiles.get(a.user_id)?.avatar_url ?? null,
    })),
    checklist: rows.checklistRows.map((c) => ({ id: c.id, text: c.text, checked: c.checked, order: c.order })),
    comments: rows.commentRows.map((c) => ({
      id: c.id,
      content: c.content,
      created_at: c.created_at,
      updated_at: c.updated_at,
      author: {
        user_id: c.author_id,
        full_name: refs.profiles.get(c.author_id)?.full_name ?? null,
        username: refs.profiles.get(c.author_id)?.username ?? null,
      },
    })),
    history: rows.historyRows.map((h) => ({
      id: h.id,
      action: h.action,
      field: h.field,
      old_value: h.old_value,
      new_value: h.new_value,
      created_at: h.created_at,
      user: {
        user_id: h.user_id,
        full_name: refs.profiles.get(h.user_id)?.full_name ?? null,
        username: refs.profiles.get(h.user_id)?.username ?? null,
      },
    })),
    repositories: rows.repoRows.map((r) => ({
      id: r.repository_id,
      name: refs.reposById.get(r.repository_id)?.name ?? null,
      url: refs.reposById.get(r.repository_id)?.url ?? null,
      default_branch: refs.reposById.get(r.repository_id)?.default_branch ?? null,
    })),
    labels: rows.labelRows.map((l) => ({
      id: l.label_id,
      name: refs.labelsById.get(l.label_id)?.name ?? null,
      color: refs.labelsById.get(l.label_id)?.color ?? null,
    })),
  };
}

export async function handler(args: unknown, ctx: ToolContext): Promise<CallToolResult> {
  const parsed = ArgsSchema.safeParse(args);
  if (!parsed.success) return errorResult(`Argumento inválido: ${parsed.error.message}`);
  const { task_id } = parsed.data;
  const cfg = resolveProjectConfig(ctx, parsed.data.project_id);
  if (isErrorResult(cfg)) return cfg;

  try {
    const detail = await ctx.gateway.getTaskWithRelations(task_id, cfg.project_id);
    if (!detail) return errorResult('Tarefa não encontrada ou fora do projeto atual.');
    const { userIds, repoIds, labelIds } = collectRelatedIds(detail.task, detail.rows);
    const refs = await ctx.gateway.loadTaskRefs(userIds, repoIds, labelIds);
    return jsonResult(formatTaskDetail(detail.task, detail.rows, refs));
  } catch (err) {
    return errorResult((err as Error).message);
  }
}
