/**
 * Implementação Postgres/pgvector do `DaxMemory` (port em `core/rag.ts`): o cache
 * semântico de consultas DAX que **deram certo**. Contrato nunca-lança — falha vira
 * `RagResult` com `status`.
 *
 * Dois modos de busca, do mais barato pro mais caro:
 *   1. `findByQuestion` → hit exato pelo `question_hash` (índice unique, sem vetor).
 *   2. `findSimilar`    → vizinho mais próximo por cosseno (`<=>`), já filtrado pelo
 *      modelo semântico — um DAX só vale no dataset em que nasceu.
 */
import type {
  DaxMemory,
  DaxOutputSummary,
  DaxTemplate,
  RagResult,
  ScoredTemplate,
} from '../../core/rag.js';
import { EMBEDDING_DIMS } from '../../core/rag.js';
// Função pura (sem IO): a regra de hash é a mesma do orquestrador — reusar evita
// duas definições divergentes da chave de cache.
import { questionHash } from '../../app/rag-templates.js';
import { query } from './client.js';

/** Linha crua de `dax_query_template` (snake_case). `id` vem como string (BIGSERIAL). */
interface TemplateRow {
  id: string;
  request_name: string;
  question_norm: string;
  workspace_id: string;
  dataset_id: string;
  dax: string;
  output_summary: DaxOutputSummary;
  score?: number;
}

const COLS =
  'id, request_name, question_norm, workspace_id, dataset_id, dax, output_summary';

/** Literal de vetor do pgvector: `[0.1,0.2,…]`. */
function toVector(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

function mapTemplateRow(row: TemplateRow, score: number): ScoredTemplate {
  return {
    id: Number(row.id),
    score,
    requestName: row.request_name,
    questionNorm: row.question_norm,
    workspaceId: row.workspace_id,
    datasetId: row.dataset_id,
    dax: row.dax,
    outputSummary: row.output_summary,
  };
}

/** Banco fora do ar é `unavailable` (dá pra tentar de novo); o resto é `failed`. */
function fail(err: unknown): RagResult<never> {
  const message = (err as Error).message ?? String(err);
  const offline = /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|terminating connection|57P03/i.test(
    message,
  );
  return { status: offline ? 'unavailable' : 'failed', error: message };
}

/** Embedding com dimensão errada corrompe a coluna `vector(768)` — barra antes do INSERT. */
function wrongDims(embedding: number[]): RagResult<never> | null {
  if (embedding.length === EMBEDDING_DIMS) return null;
  return {
    status: 'failed',
    error: `embedding com ${embedding.length} dimensões; a coluna espera ${EMBEDDING_DIMS} (trocou de modelo?)`,
  };
}

export function createDaxMemoryRepository(): DaxMemory {
  return {
    async findByQuestion(questionNorm, workspaceId, datasetId) {
      try {
        const hash = questionHash(questionNorm, workspaceId, datasetId);
        const res = await query<TemplateRow>(
          `SELECT ${COLS} FROM dax_query_template WHERE question_hash = $1 LIMIT 1`,
          [hash],
        );
        const row = res.rows[0];
        // Hit exato: a pergunta normalizada é a mesma, então score é 1 por definição.
        return { status: 'ok', data: row ? mapTemplateRow(row, 1) : null };
      } catch (err) {
        return fail(err);
      }
    },

    async findSimilar(embedding, workspaceId, datasetId, minScore) {
      const bad = wrongDims(embedding);
      if (bad) return bad;
      try {
        const res = await query<TemplateRow>(
          `SELECT ${COLS}, 1 - (embedding <=> $1::vector) AS score
             FROM dax_query_template
            WHERE workspace_id = $2 AND dataset_id = $3
            ORDER BY embedding <=> $1::vector
            LIMIT 1`,
          [toVector(embedding), workspaceId, datasetId],
        );
        const row = res.rows[0];
        if (!row) return { status: 'ok', data: null };
        const score = Number(row.score ?? 0);
        // Abaixo do limiar preferimos gerar de novo a servir a consulta errada.
        return { status: 'ok', data: score >= minScore ? mapTemplateRow(row, score) : null };
      } catch (err) {
        return fail(err);
      }
    },

    async remember(template: DaxTemplate, embedding) {
      const bad = wrongDims(embedding);
      if (bad) return bad;
      try {
        const hash = questionHash(template.questionNorm, template.workspaceId, template.datasetId);
        // Mesma pergunta no mesmo modelo → atualiza o DAX/resumo (a última execução
        // bem-sucedida é a boa), sem duplicar linha.
        const res = await query<{ id: string }>(
          `INSERT INTO dax_query_template
             (request_name, question_norm, question_hash, workspace_id, dataset_id,
              dax, output_summary, embedding, last_ok_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::vector, NOW())
           ON CONFLICT (question_hash) DO UPDATE
             SET dax = EXCLUDED.dax,
                 output_summary = EXCLUDED.output_summary,
                 embedding = EXCLUDED.embedding,
                 request_name = EXCLUDED.request_name,
                 last_ok_at = NOW()
           RETURNING id`,
          [
            template.requestName,
            template.questionNorm,
            hash,
            template.workspaceId,
            template.datasetId,
            template.dax,
            JSON.stringify(template.outputSummary),
            toVector(embedding),
          ],
        );
        return { status: 'ok', data: Number(res.rows[0]!.id) };
      } catch (err) {
        return fail(err);
      }
    },

    async markHit(id) {
      try {
        await query(
          `UPDATE dax_query_template SET hit_count = hit_count + 1, last_ok_at = NOW() WHERE id = $1`,
          [id],
        );
        return { status: 'ok' };
      } catch (err) {
        return fail(err);
      }
    },
  };
}
