// Tool `nio_fabric_query` — executa DAX dinâmico contra um dataset do Power BI/Fabric.
import { z } from 'zod';
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { FabricGateway } from '../core/fabric.js';
import type { ToolContext } from './index.js';
import { jsonResult, errorResult } from '../lib/tool-result.js';
import { brand } from '../brand.js';
import { fabricGateway, fabricErrorResult, orEnvDefault, capRows } from './fabric-shared.js';
import { checkDaxTables, explainUnknownTables, parseInventory } from '../app/dax-guard.js';
import { INVENTORY_PATH, schemaRepo } from '../app/schema-chunker.js';
import { findChunkByPath } from '../adapters/pg/doc-index-repository.js';

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
    'Executa um DAX (DEFINE/EVALUATE) contra um dataset do Power BI/Fabric e devolve as ' +
    'linhas. **Use apenas com nomes de tabela e coluna que você VERIFICOU neste modelo** — ' +
    'por `nio_fabric_ask`, `nio_fabric_schema_sync` ou uma consulta anterior que funcionou. ' +
    'Se você está montando o DAX de memória ou supondo os nomes, use `nio_fabric_ask`: ele ' +
    'gera o DAX com o schema real e erra muito menos. Nome inventado aqui é recusado antes ' +
    'de sair (ou vira 400 do Fabric). Limites da API: 1 query por chamada, 1 tabela, máx. ' +
    '100k linhas / 1M valores / 15MB, 120 req/min. `workspace_id`/`dataset_id` caem nos ' +
    'defaults NIO_FABRIC_WORKSPACE/NIO_FABRIC_DATASET se omitidos.',
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

/** Traz o inventário de tabelas do acervo indexado. `[]` = sem acervo → não valida. */
export type InventoryLoader = (datasetId: string) => Promise<string[]>;

/**
 * Núcleo testável — gateway + ids já resolvidos.
 *
 * Confere os nomes de tabela contra o acervo ANTES de gastar request: o erro do Fabric
 * é um 400 seco (`Cannot find table`) que não diz quais tabelas existem, então cada
 * chute custa uma das 120 req/min e o modelo chuta de novo. Sem acervo, executa igual —
 * bloquear por ignorância seria pior que o 400.
 */
export async function runFabricQuery(
  gw: FabricGateway,
  workspaceId: string,
  datasetId: string,
  dax: string,
  loadInventory?: InventoryLoader,
): Promise<CallToolResult> {
  if (loadInventory) {
    const inventory = await loadInventory(datasetId);
    const check = checkDaxTables(dax, inventory);
    if (check.unknown.length > 0) return errorResult(explainUnknownTables(check, inventory));
  }
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

  return runFabricQuery(fabricGateway(), workspaceId, datasetId, parsed.data.dax, inventoryFromIndex);
}

/** Inventário do acervo vetorial. Qualquer falha vira `[]` — a validação é opcional. */
async function inventoryFromIndex(datasetId: string): Promise<string[]> {
  const chunk = await findChunkByPath(schemaRepo(datasetId), INVENTORY_PATH);
  return chunk.status === 'ok' ? parseInventory(chunk.data) : [];
}
