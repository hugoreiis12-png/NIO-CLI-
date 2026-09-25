/**
 * Implementação Postgres/pgvector do `LessonStore` (port em `core/learning.ts`).
 * Contrato nunca-lança: aprendizado é acessório e não pode derrubar o turno.
 *
 * Fica no banco **compartilhado** de propósito — a lição de um colaborador vale para o
 * time. É a vantagem de ser ferramenta de equipe, e não agente pessoal de uma máquina.
 */
import type {
  LearningResult,
  Lesson,
  LessonStore,
  ScoredLesson,
} from '../../core/learning.js';
import { EMBEDDING_DIMS } from '../../core/rag.js';
import { query } from './client.js';

interface LessonRow {
  tool: string;
  profile: string | null;
  sintoma: string;
  sintoma_hash: string;
  causa: string | null;
  solucao: string;
  usos: number;
  acertos: number;
  score?: number;
}

const toVector = (embedding: number[]): string => `[${embedding.join(',')}]`;

function fail<T>(err: unknown): LearningResult<T> {
  return { status: 'unavailable', error: err instanceof Error ? err.message : String(err) };
}

function mapRow(row: LessonRow): ScoredLesson {
  return {
    tool: row.tool,
    profile: row.profile ?? undefined,
    sintoma: row.sintoma,
    sintomaHash: row.sintoma_hash,
    causa: row.causa ?? undefined,
    solucao: row.solucao,
    usos: Number(row.usos ?? 0),
    acertos: Number(row.acertos ?? 0),
    score: Number(row.score ?? 0),
  };
}

export function createLessonStore(): LessonStore {
  return {
    async save(lesson: Lesson, embedding: number[]) {
      if (embedding.length !== EMBEDDING_DIMS) {
        return { status: 'failed', error: `embedding com ${embedding.length} dimensões` };
      }
      try {
        // Mesmo erro na mesma tool é UMA lição: o conflito atualiza a solução mais
        // recente em vez de empilhar linha repetida.
        const res = await query<{ id: string }>(
          `INSERT INTO agent_lesson (tool, profile, sintoma, sintoma_hash, causa, solucao, embedding, autor)
             VALUES ($1, $2, $3, $4, $5, $6, $7::vector, $8)
           ON CONFLICT (tool, sintoma_hash) DO UPDATE
             SET solucao = EXCLUDED.solucao,
                 causa   = COALESCE(EXCLUDED.causa, agent_lesson.causa)
           RETURNING id`,
          [
            lesson.tool,
            lesson.profile ?? null,
            lesson.sintoma,
            lesson.sintomaHash,
            lesson.causa ?? null,
            lesson.solucao,
            toVector(embedding),
            process.env.USERNAME ?? process.env.USER ?? null,
          ],
        );
        return { status: 'ok', data: Number(res.rows[0]?.id ?? 0) };
      } catch (err) {
        return fail(err);
      }
    },

    async recall(tool: string, embedding: number[], topK: number) {
      if (embedding.length !== EMBEDDING_DIMS) {
        return { status: 'failed', error: `embedding com ${embedding.length} dimensões` };
      }
      try {
        // `WHERE tool` é filtro DURO. Medido no RAG de DAX: pergunta errada pontua
        // 0,955 e paráfrase legítima 0,928 — similaridade sozinha não separa, então
        // sem este recorte a lição de uma ferramenta vazaria para outra.
        const res = await query<LessonRow>(
          `SELECT tool, profile, sintoma, sintoma_hash, causa, solucao, usos, acertos,
                  1 - (embedding <=> $1::vector) AS score
             FROM agent_lesson
            WHERE tool = $2
            ORDER BY embedding <=> $1::vector
            LIMIT $3`,
          [toVector(embedding), tool, Math.max(1, topK)],
        );
        return { status: 'ok', data: res.rows.map(mapRow) };
      } catch (err) {
        return fail(err);
      }
    },

    async registerOutcome(tool: string, sintomaHash: string, acertou: boolean) {
      try {
        await query(
          `UPDATE agent_lesson
              SET usos = usos + 1,
                  acertos = acertos + $3,
                  last_used_at = now()
            WHERE tool = $1 AND sintoma_hash = $2`,
          [tool, sintomaHash, acertou ? 1 : 0],
        );
        return { status: 'ok' };
      } catch (err) {
        return fail(err);
      }
    },
  };
}

/**
 * Lições que nunca acertaram depois de N usos. Lição ruim é pior que lição nenhuma —
 * ela aparece no prompt e empurra o modelo para o caminho errado com ar de autoridade.
 */
export async function lessonsToPrune(minUsos = 5): Promise<LearningResult<ScoredLesson[]>> {
  try {
    const res = await query<LessonRow>(
      `SELECT tool, profile, sintoma, sintoma_hash, causa, solucao, usos, acertos
         FROM agent_lesson
        WHERE usos >= $1 AND acertos = 0`,
      [minUsos],
    );
    return { status: 'ok', data: res.rows.map(mapRow) };
  } catch (err) {
    return fail(err);
  }
}
