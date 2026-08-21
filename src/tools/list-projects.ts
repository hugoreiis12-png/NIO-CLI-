import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext } from './index.js';
import { jsonResult, errorResult } from '../lib/tool-result.js';
import { loadActiveProjectId } from '../lib/active-project.js';
import { ProjectContextError } from '../lib/project-context.js';
import { brand } from '../brand.js';

export const definition: Tool = {
  name: `${brand.toolPrefix}list_projects`,
  description:
    `Lista os projetos do ${brand.productName} aos quais você tem acesso. Use para descobrir qual ` +
    `projeto operar e então chame \`${brand.toolPrefix}set_project\` com o id escolhido. O campo ` +
    '"active" indica o projeto atualmente selecionado.',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
};

export async function handler(_args: unknown, ctx: ToolContext): Promise<CallToolResult> {
  let rows: { id: string; name: string }[];
  try {
    rows = await ctx.gateway.listProjects(ctx.user.id);
  } catch (err) {
    if (err instanceof ProjectContextError) return errorResult(err.message);
    return errorResult(`Erro ao listar projetos: ${(err as Error).message}`);
  }

  const active = loadActiveProjectId() ?? ctx.config?.project_id ?? null;
  const projects = rows.map((p) => ({
    id: p.id,
    name: p.name,
    active: p.id === active,
  }));

  return jsonResult({
    projects,
    active_project_id: active,
    count: projects.length,
  });
}
