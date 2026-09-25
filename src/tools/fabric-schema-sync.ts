// Tool `nio_fabric_schema_sync` — reindexa o schema de um modelo semântico.
// O `nio_fabric_ask` já indexa sob demanda na primeira pergunta; esta tool existe pro
// caso em que o MODELO MUDOU (tabela/medida nova) e o acervo ficou velho.
import { z } from 'zod';
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { RagStatus } from '../core/rag.js';
import type { ToolContext } from './index.js';
import { jsonResult, errorResult } from '../lib/tool-result.js';
import { brand } from '../brand.js';
import { ingestSchema, type SchemaIngestDeps } from '../app/schema-ingest.js';
import { createLocalEmbedder } from '../adapters/embed/local-embedder.js';
import { createDocIndexRepository } from '../adapters/pg/doc-index-repository.js';
import { fabricGateway, orEnvDefault } from './fabric-shared.js';
import { createFabricScanner } from '../adapters/fabric/scanner.js';

const ArgsSchema = z
  .object({
    workspace_id: z.string().min(1).optional(),
    dataset_id: z.string().min(1).optional(),
    force: z.boolean().optional(),
  })
  .strict();

export const definition: Tool = {
  name: `${brand.cliToolPrefix}fabric_schema_sync`,
  description:
    'Reindexa o schema (tabelas, colunas, medidas) de um modelo semântico do Power BI/Fabric ' +
    'no índice vetorial que dá contexto ao `nio_fabric_ask`. Normalmente NÃO é preciso chamar: ' +
    'o `nio_fabric_ask` indexa sozinho na primeira pergunta de cada dataset. Use quando o ' +
    'modelo mudou (tabela/medida nova) e as respostas estiverem desatualizadas. Schema ' +
    'inalterado não reembeda nada.',
  inputSchema: {
    type: 'object',
    properties: {
      workspace_id: { type: 'string', description: 'GUID do workspace. Default: NIO_FABRIC_WORKSPACE.' },
      dataset_id: { type: 'string', description: 'GUID do dataset. Default: NIO_FABRIC_DATASET.' },
      force: { type: 'boolean', description: 'Reindexa mesmo se o schema não mudou.' },
    },
    additionalProperties: false,
  },
};

const ERROR_LABEL: Record<Exclude<RagStatus, 'ok'>, string> = {
  unconfigured: 'Busca vetorial não habilitada (embedder local ausente)',
  unavailable: 'Dependência indisponível (banco, modelo ou Fabric)',
  failed: 'Falha ao indexar o schema',
};

/** Núcleo testável — deps já resolvidas. */
export async function runSchemaSync(
  deps: SchemaIngestDeps,
  workspaceId: string,
  datasetId: string,
  force?: boolean,
): Promise<CallToolResult> {
  const out = await ingestSchema(deps, { workspaceId, datasetId, force });
  if (out.status !== 'ok' || !out.data) {
    return errorResult(
      `${ERROR_LABEL[out.status as Exclude<RagStatus, 'ok'>]}: ${out.error ?? 'sem detalhe'}`,
    );
  }
  const r = out.data;
  return jsonResult(
    r.unchanged
      ? { estado: 'schema inalterado — nada reindexado', ref: r.ref }
      : {
          estado: 'schema indexado',
          tabelas: r.tables,
          medidas: r.measures,
          chunks: r.chunks,
          novos: r.inserted,
          ref: r.ref,
        },
  );
}

export async function handler(args: unknown, _ctx: ToolContext): Promise<CallToolResult> {
  const parsed = ArgsSchema.safeParse(args);
  if (!parsed.success) return errorResult(`Argumento inválido: ${parsed.error.message}`);

  const workspaceId = orEnvDefault(parsed.data.workspace_id, 'NIO_FABRIC_WORKSPACE');
  const datasetId = orEnvDefault(parsed.data.dataset_id, 'NIO_FABRIC_DATASET');
  if (!workspaceId) return errorResult('workspace_id ausente e NIO_FABRIC_WORKSPACE não definido.');
  if (!datasetId) return errorResult('dataset_id ausente e NIO_FABRIC_DATASET não definido.');

  return runSchemaSync(
    { fabric: fabricGateway(), embedder: createLocalEmbedder(), index: createDocIndexRepository(), scanner: createFabricScanner() },
    workspaceId,
    datasetId,
    parsed.data.force,
  );
}