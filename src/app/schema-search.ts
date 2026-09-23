/**
 * Monta o contexto de grounding do Nível 2: **inventário de tabelas sempre** +
 * top-k por similaridade.
 *
 * Por que o inventário é garantido e não deixado à sorte do ranking: o erro que
 * queremos matar é nome de tabela inventado (`Cannot find table 'Metas'`). São 17
 * nomes — cabe em duas linhas. Confiar que o top-k traga a tabela certa é apostar
 * justamente onde não podemos errar. Medidas e colunas (centenas) seguem por busca.
 */
import type { DocIndex, RagResult } from '../core/rag.js';
import { INVENTORY_PATH, schemaRepo } from './schema-chunker.js';

/** Busca direta por caminho (o inventário) — sem similaridade. */
export type ChunkByPath = (repo: string, path: string) => Promise<RagResult<string | null>>;

export interface SchemaSearchDeps {
  index: DocIndex;
  byPath: ChunkByPath;
  topK: number;
}

/**
 * Devolve a função `searchDocs` que o orquestrador injeta. Nunca lança; se o acervo
 * estiver vazio (schema nunca sincronizado), devolve lista vazia e a geração segue
 * sem grounding — degradar é melhor que travar.
 */
export function createSchemaSearch(
  deps: SchemaSearchDeps,
  datasetId: string,
): (embedding: number[]) => Promise<RagResult<string[]>> {
  const repo = schemaRepo(datasetId);

  return async (embedding: number[]): Promise<RagResult<string[]>> => {
    const docs: string[] = [];

    const inventory = await deps.byPath(repo, INVENTORY_PATH);
    if (inventory.status === 'ok' && inventory.data) docs.push(inventory.data);

    const hits = await deps.index.search(embedding, deps.topK);
    if (hits.status === 'ok') {
      // O inventário já entrou acima — não repetir se ele também ranquear.
      for (const chunk of hits.data ?? []) {
        if (chunk.path !== INVENTORY_PATH) docs.push(chunk.content);
      }
    } else if (docs.length === 0) {
      return { status: hits.status, error: hits.error };
    }

    return { status: 'ok', data: docs };
  };
}
