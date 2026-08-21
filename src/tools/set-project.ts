import { z } from 'zod';
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext } from './index.js';
import { jsonResult, errorResult } from '../lib/tool-result.js';
import { setActiveProjectId } from '../lib/active-project.js';
import { brand } from '../brand.js';

const ArgsSchema = z
  .object({
    project_id: z.uuid(),
  })
  .strict();

export const definition: Tool = {
  name: `${brand.toolPrefix}set_project`,
  description:
    'Define o projeto ativo da sessão (em memória, dura enquanto o servidor estiver ' +
    'rodando). As tools de tarefa/alocação passam a operar nesse projeto, até você trocar ' +
    `de novo. Use \`${brand.toolPrefix}list_projects\` antes para descobrir os ids.`,
  inputSchema: {
    type: 'object',
    properties: {
      project_id: {
        type: 'string',
        format: 'uuid',
        description: `UUID do projeto (de ${brand.toolPrefix}list_projects).`,
      },
    },
    required: ['project_id'],
    additionalProperties: false,
  },
};

export async function handler(args: unknown, ctx: ToolContext): Promise<CallToolResult> {
  const parsed = ArgsSchema.safeParse(args);
  if (!parsed.success) {
    return errorResult(`Argumento inválido: ${parsed.error.message}`);
  }
  const { project_id } = parsed.data;

  // Valida que o projeto existe e é acessível pelo usuário (RLS aplica o escopo).
  let project;
  try {
    project = await ctx.gateway.findProjectById(project_id);
  } catch (err) {
    return errorResult((err as Error).message);
  }
  if (!project) {
    return errorResult(`Projeto não encontrado ou sem acesso. Confira o id em \`${brand.toolPrefix}list_projects\`.`);
  }

  setActiveProjectId(project_id);

  return jsonResult({
    active_project_id: project.id,
    name: project.name,
    message: `Projeto ativo agora é "${project.name}".`,
  });
}
