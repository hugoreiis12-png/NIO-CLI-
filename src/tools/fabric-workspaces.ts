// Tool `nio_fabric_workspaces` — lista os workspaces visíveis ao service principal.
import { z } from 'zod';
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext } from './index.js';
import { jsonResult, errorResult } from '../lib/tool-result.js';
import { brand } from '../brand.js';
import { fabricGateway, fabricErrorResult, leanList } from './fabric-shared.js';

const ArgsSchema = z.object({}).strict();

export const definition: Tool = {
  name: `${brand.cliToolPrefix}fabric_workspaces`,
  description:
    'Lista os workspaces (grupos) do Power BI/Fabric visíveis ao service principal — descoberta ' +
    'para achar o `workspace_id` que o `nio_fabric_query`/`nio_fabric_datasets` precisam.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
};

export async function handler(args: unknown, _ctx: ToolContext): Promise<CallToolResult> {
  const parsed = ArgsSchema.safeParse(args);
  if (!parsed.success) return errorResult(`Argumento inválido: ${parsed.error.message}`);

  const out = await fabricGateway().listWorkspaces();
  if (out.status !== 'ok') return fabricErrorResult(out.status, out.error);
  return jsonResult({ workspaces: leanList(out.data ?? []) });
}
