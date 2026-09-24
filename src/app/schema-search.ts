/**
 * Monta o contexto de grounding do Nível 2: **inventário de tabelas sempre** +
 * top-k por similaridade.
 *
 * Por que o inventário é garantido e não deixado à sorte do ranking: o erro que
 * queremos matar é nome de tabela inventado (`Cannot find table 'Metas'`). São 17
 * nomes — cabe em duas linhas. Confiar que o top-k traga a tabela certa é apostar
 * justamente onde não podemos errar. Medidas e colunas (centenas) seguem por busca.
 */
import type { DocIndex, RagResult, ScoredChunk } from '../core/rag.js';
import { INVENTORY_PATH, schemaRepo } from './schema-chunker.js';
import {
  NIO_FABRIC_RAG_MIN_SCORE,
  NIO_FABRIC_RAG_MAX_CHUNK_CHARS,
  NIO_FABRIC_RAG_MAX_TOTAL_CHARS,
} from '../lib/clients/client-configs.js';

/** Busca direta por caminho (o inventário) — sem similaridade. */
export type ChunkByPath = (repo: string, path: string) => Promise<RagResult<string | null>>;

export interface SchemaSearchDeps {
  index: DocIndex;
  byPath: ChunkByPath;
  topK: number;
  /** Piso de similaridade: abaixo disso o vizinho é ruído e só gasta token. */
  minScore?: number;
  /** Teto por chunk — uma tabela larga vira centenas de `Nome (tipo)` numa string só. */
  maxChunkChars?: number;
  /** Teto do bloco inteiro de grounding. */
  maxTotalChars?: number;
  /**
   * Busca restrita a chunks de tabela. Sem isso o top-k geral vem só com medidas e
   * **nenhuma coluna** chega ao contexto — o modelo inventa a coluna e leva 400.
   */
  searchTables?: (embedding: number[]) => Promise<RagResult<ScoredChunk[]>>;
  /** Quantas tabelas garantir no contexto. */
  tableSlots?: number;
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
  const minScore = deps.minScore ?? NIO_FABRIC_RAG_MIN_SCORE;
  const maxChunk = deps.maxChunkChars ?? NIO_FABRIC_RAG_MAX_CHUNK_CHARS;
  const maxTotal = deps.maxTotalChars ?? NIO_FABRIC_RAG_MAX_TOTAL_CHARS;

  const clamp = (text: string): string =>
    text.length > maxChunk ? `${text.slice(0, maxChunk)}…` : text;

  return async (embedding: number[]): Promise<RagResult<string[]>> => {
    const docs: string[] = [];
    let total = 0;

    // O inventário entra sempre, mesmo que consuma parte do orçamento: é ele que
    // impede nome de tabela inventado.
    const inventory = await deps.byPath(repo, INVENTORY_PATH);
    if (inventory.status === 'ok' && inventory.data) {
      const inv = clamp(inventory.data);
      docs.push(inv);
      total = inv.length;
    }

    // Tabelas primeiro: são elas que trazem as COLUNAS. O top-k geral abaixo é dominado
    // por medidas, então sem esta reserva o contexto fica sem nome de coluna nenhum.
    const vistos = new Set<string>();
    if (deps.searchTables) {
      const tabelas = await deps.searchTables(embedding);
      if (tabelas.status === 'ok') {
        for (const chunk of (tabelas.data ?? []).slice(0, deps.tableSlots ?? 2)) {
          const texto = clamp(chunk.content);
          if (total + texto.length > maxTotal) break;
          docs.push(texto);
          total += texto.length;
          vistos.add(chunk.path);
        }
      }
    }

    const hits = await deps.index.search(repo, embedding, deps.topK);
    if (hits.status === 'ok') {
      // O inventário já entrou acima — não repetir se ele também ranquear.
      for (const chunk of hits.data ?? []) {
        if (chunk.path === INVENTORY_PATH) continue;
        if (vistos.has(chunk.path)) continue; // já entrou pela reserva de tabelas
        if (chunk.score < minScore) continue;
        const texto = clamp(chunk.content);
        if (total + texto.length > maxTotal) break; // orçamento estourado
        docs.push(texto);
        total += texto.length;
      }
    } else if (docs.length === 0) {
      return { status: hits.status, error: hits.error };
    }

    return { status: 'ok', data: docs };
  };
}
