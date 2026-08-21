import { z } from 'zod';
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext } from './index.js';
import { jsonResult, errorResult } from '../lib/tool-result.js';
import { resolveProjectConfig, isErrorResult } from '../lib/require-config.js';
import { brand, env } from '../brand.js';

const ArgsSchema = z
  .object({
    title: z.string().min(1),
    task_id: z.uuid().optional(),
    pr_url: z.url().optional(),
    iterations: z.number().int().nonnegative().optional(),
    project_id: z.uuid().optional(),
  })
  .strict();

export const definition: Tool = {
  name: `${brand.toolPrefix}record_delivery`,
  description:
    'Registra uma ENTREGA do loop de build (um ticket concluído / PR aberto) na analítica ' +
    `de entrega do ${brand.productName}. Chamado pelo \`/build\` no fecho. Guarda título, PR, iterações e ` +
    'vincula à tarefa/projeto. Uma chamada por ticket entregue.',
  inputSchema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Título curto do que foi entregue (o ticket/feature).',
      },
      task_id: {
        type: 'string',
        format: 'uuid',
        description: `Tarefa do ${brand.productName} entregue, se o ticket tiver esse vínculo.`,
      },
      pr_url: { type: 'string', description: 'URL do PR aberto.' },
      iterations: {
        type: 'number',
        description: 'Quantas iterações do loop até passar no gate de qualidade.',
      },
      project_id: {
        type: 'string',
        format: 'uuid',
        description: `Override do projeto. Se omitido, usa o ativo (${brand.toolPrefix}set_project) ou o default.`,
      },
    },
    required: ['title'],
    additionalProperties: false,
  },
};

export async function handler(args: unknown, ctx: ToolContext): Promise<CallToolResult> {
  const parsed = ArgsSchema.safeParse(args);
  if (!parsed.success) {
    return errorResult(`Argumento inválido: ${parsed.error.message}`);
  }

  const cfg = resolveProjectConfig(ctx, parsed.data.project_id);
  if (isErrorResult(cfg)) return cfg;

  const row = {
    user_id: ctx.user.id,
    project_id: cfg.project_id,
    task_id: parsed.data.task_id ?? null,
    title: parsed.data.title,
    pr_url: parsed.data.pr_url ?? null,
    iterations: parsed.data.iterations ?? null,
    client: env('CLIENT') ?? null,
  };

  try {
    await ctx.gateway.recordDelivery(row);
  } catch (err) {
    return errorResult((err as Error).message);
  }

  return jsonResult({ ok: true, recorded: row.title, pr_url: row.pr_url });
}
