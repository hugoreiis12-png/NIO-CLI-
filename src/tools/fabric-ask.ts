// Tool `nio_fabric_ask` — pergunta em linguagem natural → DAX → linhas do Fabric,
// com cache semântico de 3 níveis (ver `app/dax-rag.ts`).
import { z } from 'zod';
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { RagStatus } from '../core/rag.js';
import type { ToolContext } from './index.js';
import { jsonResult, errorResult } from '../lib/tool-result.js';
import { brand } from '../brand.js';
import { askDax, type DaxRagDeps } from '../app/dax-rag.js';
import { createDaxGenerator } from '../app/dax-generator.js';
import { createDaxMemoryRepository } from '../adapters/pg/dax-memory-repository.js';
import { createLocalEmbedder } from '../adapters/embed/local-embedder.js';
import { createDocIndexRepository, findChunkByPath } from '../adapters/pg/doc-index-repository.js';
import { createSchemaSearch } from '../app/schema-search.js';
import { NIO_FABRIC_RAG_TOPK } from '../lib/clients/client-configs.js';
import { fabricGateway, orEnvDefault } from './fabric-shared.js';

const ArgsSchema = z
  .object({
    question: z.string().min(1),
    workspace_id: z.string().min(1).optional(),
    dataset_id: z.string().min(1).optional(),
    request_name: z.string().min(1).optional(),
  })
  .strict();

export const definition: Tool = {
  name: `${brand.cliToolPrefix}fabric_ask`,
  description:
    'Responde uma pergunta em linguagem natural com dados de um modelo semântico do ' +
    'Power BI/Fabric: gera o DAX, executa via executeQueries e devolve as linhas. ' +
    'Reaproveita consultas já validadas (cache vetorial) — repetir a mesma pergunta não ' +
    'gasta o modelo. Prefira esta tool a `nio_fabric_query` quando não souber o DAX exato; ' +
    'use `nio_fabric_query` para rodar um DAX que você já tem pronto. ' +
    '`workspace_id`/`dataset_id` caem nos defaults NIO_FABRIC_WORKSPACE/NIO_FABRIC_DATASET.',
  inputSchema: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'Pergunta em linguagem natural (pt-BR).' },
      workspace_id: { type: 'string', description: 'GUID do workspace. Default: NIO_FABRIC_WORKSPACE.' },
      dataset_id: { type: 'string', description: 'GUID do dataset. Default: NIO_FABRIC_DATASET.' },
      request_name: { type: 'string', description: 'Nome curto da request, guardado no cache.' },
    },
    required: ['question'],
    additionalProperties: false,
  },
};

const RAG_ERROR_LABEL: Record<Exclude<RagStatus, 'ok'>, string> = {
  unconfigured: 'Busca vetorial não habilitada',
  unavailable: 'Dependência indisponível (banco, modelo ou Fabric)',
  failed: 'Falha ao responder a partir do Fabric',
};

/** Como a resposta foi obtida — explicitado pro agente entender o custo. */
const TIER_LABEL = {
  replay: 'cache (pergunta idêntica — DAX reexecutado)',
  adapted: 'cache adaptado (consulta parecida ajustada)',
  generated: 'gerado (consulta nova)',
} as const;

/** Núcleo testável — deps já resolvidas. */
export async function runFabricAsk(
  deps: DaxRagDeps,
  workspaceId: string,
  datasetId: string,
  question: string,
  requestName?: string,
): Promise<CallToolResult> {
  const out = await askDax(deps, { question, workspaceId, datasetId, requestName });
  if (out.status !== 'ok' || !out.data) {
    return errorResult(`${RAG_ERROR_LABEL[out.status as Exclude<RagStatus, 'ok'>]}: ${out.error ?? 'sem detalhe'}`);
  }
  const { tier, dax, rows, score } = out.data;
  return jsonResult({
    origem: TIER_LABEL[tier],
    dax, // sempre devolvido: o agente pode conferir e reusar via nio_fabric_query
    row_count: rows.length,
    rows,
    ...(score !== undefined ? { similaridade: Number(score.toFixed(4)) } : {}),
  });
}

/** Monta as dependências de produção. Separado pra o teste injetar fakes. */
function productionDeps(datasetId: string): DaxRagDeps {
  return {
    memory: createDaxMemoryRepository(),
    embedder: createLocalEmbedder(),
    fabric: fabricGateway(),
    generate: createDaxGenerator(),
    // Nível 2: grounding no schema do modelo (inventário de tabelas + top-k).
    // Sem acervo sincronizado devolve vazio e a geração segue sem contexto.
    searchDocs: createSchemaSearch(
      { index: createDocIndexRepository(), byPath: findChunkByPath, topK: NIO_FABRIC_RAG_TOPK },
      datasetId,
    ),
  };
}

export async function handler(args: unknown, _ctx: ToolContext): Promise<CallToolResult> {
  const parsed = ArgsSchema.safeParse(args);
  if (!parsed.success) return errorResult(`Argumento inválido: ${parsed.error.message}`);

  const workspaceId = orEnvDefault(parsed.data.workspace_id, 'NIO_FABRIC_WORKSPACE');
  const datasetId = orEnvDefault(parsed.data.dataset_id, 'NIO_FABRIC_DATASET');
  if (!workspaceId) return errorResult('workspace_id ausente e NIO_FABRIC_WORKSPACE não definido.');
  if (!datasetId) return errorResult('dataset_id ausente e NIO_FABRIC_DATASET não definido.');

  return runFabricAsk(
    productionDeps(datasetId),
    workspaceId,
    datasetId,
    parsed.data.question,
    parsed.data.request_name,
  );
}
