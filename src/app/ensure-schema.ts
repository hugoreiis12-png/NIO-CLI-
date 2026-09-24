/**
 * Garante que o schema de **um** dataset está no índice antes de gerar DAX contra ele.
 *
 * Motivo: o service principal enxerga ~25 workspaces e ~80 datasets, mas o acervo só
 * cobria o dataset default. Em qualquer outro o modelo não conhece tabela nem coluna,
 * inventa nome e leva 400. Indexar sob demanda resolve sem custo para os datasets que
 * ninguém consulta.
 *
 * Atalho barato: se **algo** já está indexado para o modelo, não relê o schema (que
 * custa 3 chamadas REST). Detectar mudança de modelo é papel do
 * `nio fabric schema sync`, que compara o `ref` do conteúdo.
 */
import type { RagResult } from '../core/rag.js';
import { ingestSchema, type SchemaIngestDeps } from './schema-ingest.js';
import { schemaRepo } from './schema-chunker.js';

export type EnsureSchemaOutcome = 'ja-indexado' | 'indexado-agora';

export interface EnsureSchemaInput {
  workspaceId: string;
  datasetId: string;
}

export async function ensureSchemaIndexed(
  deps: SchemaIngestDeps,
  input: EnsureSchemaInput,
): Promise<RagResult<EnsureSchemaOutcome>> {
  const repo = schemaRepo(input.datasetId);

  const known = await deps.index.indexedRefs(repo);
  // Falha ao consultar o índice não pode impedir a resposta: seguimos sem grounding.
  if (known.status !== 'ok') return { status: known.status, error: known.error };
  if ((known.data ?? []).length > 0) return { status: 'ok', data: 'ja-indexado' };

  // `force`: acabamos de constatar que o acervo está vazio — sem isso o `ingestSchema`
  // repetiria a mesma consulta de refs no banco.
  const out = await ingestSchema(deps, { ...input, force: true });
  if (out.status !== 'ok') return { status: out.status, error: out.error };
  return { status: 'ok', data: 'indexado-agora' };
}
