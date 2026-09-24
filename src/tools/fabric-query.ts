// Tool `nio_fabric_query` — executa DAX dinâmico contra um dataset do Power BI/Fabric.
import { z } from 'zod';
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { FabricGateway } from '../core/fabric.js';
import type { ToolContext } from './index.js';
import { jsonResult, errorResult } from '../lib/tool-result.js';
import { brand } from '../brand.js';
import { fabricGateway, fabricErrorResult, orEnvDefault, capRows } from './fabric-shared.js';

const ArgsSchema = z
  .object({
    dax: z.string().min(1),
    workspace_id: z.string().min(1).optional(),
    dataset_id: z.string().min(1).optional(),
  })
  .strict();

export const definition: Tool = {
  name: `${brand.cliToolPrefix}fabric_query`,
  description:
    'Executa uma consulta DAX (DEFINE/EVALUATE) contra um dataset (modelo semântico) do ' +
    'Power BI/Fabric via executeQueries e devolve as linhas. `dax` é sempre montado sob ' +
    'demanda pela request. Limites da API: 1 query por chamada, 1 tabela, máx. 100k linhas / ' +
    '1M valores / 15MB, 120 req/min. `workspace_id`/`dataset_id` caem nos defaults ' +
    'NIO_FABRIC_WORKSPACE/NIO_FABRIC_DATASET se omitidos.',
  inputSchema: {
    type: 'object',
    properties: {
      dax: { type: 'string', description: 'Consulta DAX (DEFINE/EVALUATE) a executar.' },
      workspace_id: { type: 'string', description: 'GUID do workspace (groupId). Default: NIO_FABRIC_WORKSPACE.' },
      dataset_id: { type: 'string', description: 'GUID do dataset. Default: NIO_FABRIC_DATASET.' },
    },
    required: ['dax'],
    additionalProperties: false,
  },
};

/** Núcleo testável — gateway + ids já resolvidos. */
export async function runFabricQuery(
  gw: FabricGateway,
  workspaceId: string,
  datasetId: string,
  dax: string,
): Promise<CallToolResult> {
  const out = await gw.executeDax(workspaceId, datasetId, dax);
  if (out.status !== 'ok') return fabricErrorResult(out.status, out.error);
  return jsonResult(capRows(out.data ?? []));
}

export async function handler(args: unknown, _ctx: ToolContext): Promise<CallToolResult> {
  const parsed = ArgsSchema.safeParse(args);
  if (!parsed.success) return errorResult(`Argumento inválido: ${parsed.error.message}`);

  const workspaceId = orEnvDefault(parsed.data.workspace_id, 'NIO_FABRIC_WORKSPACE');
  const datasetId = orEnvDefault(parsed.data.dataset_id, 'NIO_FABRIC_DATASET');
  if (!workspaceId) return errorResult('workspace_id ausente e NIO_FABRIC_WORKSPACE não definido.');
  if (!datasetId) return errorResult('dataset_id ausente e NIO_FABRIC_DATASET não definido.');

  return runFabricQuery(fabricGateway(), workspaceId, datasetId, parsed.data.dax);
}
