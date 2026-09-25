/**
 * Implementação Postgres/pgvector do `DocIndex` (port em `core/rag.ts`): o acervo de
 * grounding (hoje o schema do modelo semântico). Contrato nunca-lança.
 *
 * Ingestão idempotente: a UNIQUE `(repo, ref, path, content_hash)` + `ON CONFLICT DO
 * NOTHING` fazem reingerir o mesmo `ref` custar nada. Conteúdo novo gera `ref` novo
 * (ver `schemaRef`), então versões convivem e a antiga pode ser podada.
 */
import { createHash } from 'node:crypto';
import type { DocChunk, DocIndex, RagResult, ScoredChunk } from '../../core/rag.js';
import { EMBEDDING_DIMS } from '../../core/rag.js';
import { query, withTransaction } from './client.js';

interface ChunkRow {
  repo: string;
  ref: string;
  path: string;
  heading: string | null;
  content: string;
  score?: number;
}

/** Literal de vetor do pgvector: `[0.1,0.2,…]`. */
function toVector(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function mapRow(row: ChunkRow, score: number): ScoredChunk {
  return {
    repo: row.repo,
    ref: row.ref,
    path: row.path,
    heading: row.heading ?? undefined,
    content: row.content,
    score,
  };
}

function fail(err: unknown): RagResult<never> {
  const message = (err as Error).message ?? String(err);
  const offline = /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|terminating connection|57P03/i.test(
    message,
  );
  return { status: offline ? 'unavailable' : 'failed', error: message };
}

export function createDocIndexRepository(): DocIndex {
  return {
    async indexChunks(chunks: DocChunk[], embeddings: number[][]) {
      if (chunks.length !== embeddings.length) {
        return { status: 'failed', error: `${chunks.length} chunks para ${embeddings.length} embeddings` };
      }
      const bad = embeddings.find((e) => e.length !== EMBEDDING_DIMS);
      if (bad) {
        return {
          status: 'failed',
          error: `embedding com ${bad.length} dimensões; o esquema espera ${EMBEDDING_DIMS}`,
        };
      }
      try {
        // Uma transação: ou o acervo daquele ref entra inteiro, ou não entra.
        return await withTransaction(async (tx) => {
          let inserted = 0;
          for (let i = 0; i < chunks.length; i += 1) {
            const c = chunks[i]!;
            const res = await tx.query(
              `INSERT INTO dax_doc_chunk (repo, ref, path, heading, content, content_hash, embedding)
               VALUES ($1, $2, $3, $4, $5, $6, $7::vector)
               ON CONFLICT (repo, ref, path, content_hash) DO NOTHING`,
              [c.repo, c.ref, c.path, c.heading ?? null, c.content, contentHash(c.content), toVector(embeddings[i]!)],
            );
            inserted += res.rowCount ?? 0;
          }
          return { status: 'ok' as const, data: inserted };
        });
      } catch (err) {
        return fail(err);
      }
    },

    async search(repo, embedding, topK) {
      if (embedding.length !== EMBEDDING_DIMS) {
        return { status: 'failed', error: `embedding com ${embedding.length} dimensões` };
      }
      try {
        // O filtro por `repo` não é opcional: sem ele a busca varre TODOS os modelos
        // indexados e devolve tabela de outro dataset como se fosse deste.
        const res = await query<ChunkRow>(
          `SELECT repo, ref, path, heading, content, 1 - (embedding <=> $1::vector) AS score
             FROM dax_doc_chunk
            WHERE repo = $2
            ORDER BY embedding <=> $1::vector
            LIMIT $3`,
          [toVector(embedding), repo, Math.max(1, topK)],
        );
        return { status: 'ok', data: res.rows.map((r) => mapRow(r, Number(r.score ?? 0))) };
      } catch (err) {
        return fail(err);
      }
    },

    async indexedRefs(repo) {
      try {
        const res = await query<{ ref: string }>(
          `SELECT DISTINCT ref FROM dax_doc_chunk WHERE repo = $1`,
          [repo],
        );
        return { status: 'ok', data: res.rows.map((r) => r.ref) };
      } catch (err) {
        return fail(err);
      }
    },
  };
}

/**
 * Busca um chunk pelo caminho (ex.: o inventário de tabelas, que o orquestrador
 * injeta sempre). Fora do port `DocIndex` porque é acesso direto, sem similaridade.
 */
export async function findChunkByPath(repo: string, path: string): Promise<RagResult<string | null>> {
  try {
    const res = await query<{ content: string }>(
      `SELECT content FROM dax_doc_chunk WHERE repo = $1 AND path = $2
       ORDER BY created_at DESC LIMIT 1`,
      [repo, path],
    );
    return { status: 'ok', data: res.rows[0]?.content ?? null };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Top-N **restrito aos chunks de tabela** (`path` começa com `tabela/`).
 *
 * Existe porque o top-k geral é dominado por medidas: numa pergunta como "quantas linhas
 * a VISAO_COMERCIAL tem em 2026", os 5 primeiros vinham todos como `Medida: 2024_QTDE…`
 * (o nome delas casa com "ano/2024") e **nenhuma coluna** chegava ao contexto — então o
 * modelo inventava a coluna de data e levava 400. Tabela é o que carrega as colunas.
 */
export async function searchTables(
  repo: string,
  embedding: number[],
  topN: number,
): Promise<RagResult<ScoredChunk[]>> {
  if (embedding.length !== EMBEDDING_DIMS) {
    return { status: 'failed', error: `embedding com ${embedding.length} dimensões` };
  }
  try {
    const res = await query<ChunkRow>(
      `SELECT repo, ref, path, heading, content, 1 - (embedding <=> $1::vector) AS score
         FROM dax_doc_chunk
        WHERE repo = $2 AND path LIKE 'tabela/%'
        ORDER BY embedding <=> $1::vector
        LIMIT $3`,
      [toVector(embedding), repo, Math.max(1, topN)],
    );
    return { status: 'ok', data: res.rows.map((r) => mapRow(r, Number(r.score ?? 0))) };
  } catch (err) {
    return fail(err);
  }
}

/** Quantos chunks há indexados para um modelo. Usado pelo `nio fabric rag status`. */
export async function countChunks(repo: string): Promise<RagResult<number>> {
  try {
    const res = await query<{ n: string }>(
      `SELECT count(*)::int AS n FROM dax_doc_chunk WHERE repo = $1`,
      [repo],
    );
    return { status: 'ok', data: Number(res.rows[0]?.n ?? 0) };
  } catch (err) {
    return fail(err);
  }
}

/** Quantas medidas indexadas carregam a fórmula DAX — diagnóstico do `rag status`. */
export async function countMeasuresWithExpression(repo: string): Promise<RagResult<{ total: number; comFormula: number }>> {
  try {
    const res = await query<{ total: string; com: string }>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE content LIKE '%Expressão DAX:%')::int AS com
         FROM dax_doc_chunk WHERE repo = $1 AND path LIKE 'medida/%'`,
      [repo],
    );
    const row = res.rows[0];
    return { status: 'ok', data: { total: Number(row?.total ?? 0), comFormula: Number(row?.com ?? 0) } };
  } catch (err) {
    return fail(err);
  }
}

/** Remove versões antigas do acervo de um modelo, preservando o `ref` atual. */
export async function pruneOldRefs(repo: string, keepRef: string): Promise<RagResult<number>> {
  try {
    const res = await query(`DELETE FROM dax_doc_chunk WHERE repo = $1 AND ref <> $2`, [repo, keepRef]);
    return { status: 'ok', data: res.rowCount ?? 0 };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Chunks de medida cujo nome casa com `termo` (busca literal, não semântica).
 *
 * Existe porque o acervo guarda as fórmulas desde que o scanner admin entrou, mas
 * nenhuma tool as devolvia ao agente: o grounding era consumido só pelo gerador de DAX,
 * internamente. O modelo dizia, com razão, que "não expõem o endpoint de metadados".
 */
export async function findMeasureChunks(
  repo: string,
  termo: string,
  limit = 10,
): Promise<RagResult<string[]>> {
  try {
    const like = `%${termo.trim().toLowerCase()}%`;
    const res = await query<{ content: string }>(
      `SELECT content FROM dax_doc_chunk
        WHERE repo = $1 AND path LIKE 'medida/%' AND lower(path) LIKE $2
        ORDER BY length(path) LIMIT $3`,
      [repo, like, Math.max(1, limit)],
    );
    return { status: 'ok', data: res.rows.map((r) => r.content) };
  } catch (err) {
    return fail(err);
  }
}
