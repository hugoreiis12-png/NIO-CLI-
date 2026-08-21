import { z } from 'zod';
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext } from './index.js';
import { jsonResult, errorResult } from '../lib/tool-result.js';
import { ProjectContextError } from '../lib/project-context.js';
import { resolveProjectConfig, isErrorResult } from '../lib/require-config.js';
import { brand } from '../brand.js';

const ArgsSchema = z
  .object({
    project_id: z.uuid().optional(),
  })
  .strict();

export const definition: Tool = {
  name: `${brand.toolPrefix}get_context`,
  description:
    `Retorna o contexto completo do projeto ${brand.productName} ativo: dados do projeto, repositórios, ` +
    'sprint ativa, membros e usuário autenticado. Use SEMPRE no início de uma conversa ' +
    'pra entender em que projeto você está operando. Sem projeto selecionado, use ' +
    `\`${brand.toolPrefix}list_projects\` + \`${brand.toolPrefix}set_project\` antes.`,
  inputSchema: {
    type: 'object',
    properties: {
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
  if (!parsed.success) {
    return errorResult(`Argumento inválido: ${parsed.error.message}`);
  }

  const cfg = resolveProjectConfig(ctx, parsed.data.project_id);
  if (isErrorResult(cfg)) return cfg;

  try {
    const data = await ctx.gateway.getContext(cfg, ctx.user);
    return jsonResult(data);
  } catch (err) {
    if (err instanceof ProjectContextError) {
      return errorResult(err.message);
    }
    return errorResult(`Erro inesperado: ${(err as Error).message}`);
  }
}
