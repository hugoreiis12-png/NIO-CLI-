// Tool `nio_fabric_datasets` — lista os datasets (modelos semânticos) de um workspace.
import { z } from 'zod';
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext } from './index.js';
import { jsonResult, errorResult } from '../lib/tool-result.js';
import { brand } from '../brand.js';
import { fabricGateway, fabricErrorResult, orEnvDefault } from './fabric-shared.js';

const ArgsSchema = z.object({ workspace_id: z.string().min(1).optional() }).strict();

export const definition: Tool = {
  name: `${brand.cliToolPrefix}fabric_datasets`,
  description:
    'Lista os datasets (modelos semânticos) de um workspace do Power BI/Fabric — descoberta para ' +
    'achar o `dataset_id` do `nio_fabric_query`. `workspace_id` cai em NIO_FABRIC_WORKSPACE se omitido.',
  inputSchema: {
    type: 'object',
    properties: {
      workspace_id: { type: 'string', description: 'GUID do workspace (groupId). Default: NIO_FABRIC_WORKSPACE.' },
    },
    additionalProperties: false,
  },
};

export async function handler(args: unknown, _ctx: ToolContext): Promise<CallToolResult> {
  const parsed = ArgsSchema.safeParse(args);
  if (!parsed.success) return errorResult(`Argumento inválido: ${parsed.error.message}`);

  const workspaceId = orEnvDefault(parsed.data.workspace_id, 'NIO_FABRIC_WORKSPACE');
  if (!workspaceId) return errorResult('workspace_id ausente e NIO_FABRIC_WORKSPACE não definido.');

  const out = await fabricGateway().listDatasets(workspaceId);
  if (out.status !== 'ok') return fabricErrorResult(out.status, out.error);
  return jsonResult({ datasets: out.data ?? [] });
}
