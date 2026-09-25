/**
 * Orquestra o aprendizado contínuo: detecta a lição, embeda e guarda; e no caminho de
 * volta, recupera lições parecidas para injetar como **pista**.
 *
 * Nunca lança e nunca bloqueia o turno: se o banco ou o embedder estiverem fora, o
 * usuário não pode nem perceber. Aprender é acessório; responder é a função.
 */
import type { EmbeddingProvider } from '../core/rag.js';
import type { LearningResult, LessonStore, ScoredLesson, ToolAttempt } from '../core/learning.js';
import { detectLessons, lessonEmbeddingText, renderLessons } from './lesson-detector.js';
import { lessonOutcomes, type InjectedLesson } from './lesson-outcome.js';
import { NIO_LEARN_MIN_SCORE, NIO_LEARN_TOPK } from '../lib/clients/client-configs.js';

export interface LearningDeps {
  embedder: EmbeddingProvider;
  store: LessonStore;
}

/**
 * Varre as tentativas do turno e guarda o que foi aprendido. Devolve quantas lições
 * entraram — `0` é resultado normal (a maioria dos turnos não ensina nada).
 */
export async function learnFromAttempts(
  deps: LearningDeps,
  attempts: readonly ToolAttempt[],
  profile?: string,
): Promise<LearningResult<number>> {
  const licoes = detectLessons(attempts, profile);
  if (licoes.length === 0) return { status: 'ok', data: 0 };

  const textos = licoes.map(lessonEmbeddingText);
  const vetores = await deps.embedder.embedPassages(textos);
  if (vetores.status !== 'ok' || !vetores.data) {
    return { status: vetores.status === 'unconfigured' ? 'unconfigured' : 'unavailable', error: vetores.error };
  }

  let gravadas = 0;
  for (const [i, licao] of licoes.entries()) {
    const vetor = vetores.data[i];
    if (!vetor) continue;
    const res = await deps.store.save(licao, vetor);
    if (res.status === 'ok') gravadas += 1;
  }
  return { status: 'ok', data: gravadas };
}

/**
 * Lições parecidas para uma tool. O piso de score existe porque lição irrelevante no
 * prompt é pior que lição nenhuma: ela desvia o modelo com ar de autoridade.
 */
export async function recallLessons(
  deps: LearningDeps,
  tool: string,
  contexto: string,
  topK = NIO_LEARN_TOPK,
): Promise<LearningResult<ScoredLesson[]>> {
  const vetor = await deps.embedder.embedQuery(`${tool}\n${contexto}`);
  if (vetor.status !== 'ok' || !vetor.data) {
    return { status: vetor.status === 'unconfigured' ? 'unconfigured' : 'unavailable', error: vetor.error };
  }
  const achadas = await deps.store.recall(tool, vetor.data, topK);
  if (achadas.status !== 'ok') return achadas;
  return { status: 'ok', data: (achadas.data ?? []).filter((l) => l.score >= NIO_LEARN_MIN_SCORE) };
}

/**
 * Bloco pronto para o prompt **e** quais lições entraram. O chamador precisa da lista
 * para creditar acerto/erro depois — sem isso `usos`/`acertos` nunca saem de zero e a
 * poda fica sem dado.
 */
export async function lessonsBlock(
  deps: LearningDeps,
  tool: string,
  contexto: string,
): Promise<{ text: string; injected: InjectedLesson[] }> {
  const res = await recallLessons(deps, tool, contexto);
  if (res.status !== 'ok') return { text: '', injected: [] };
  const licoes = res.data ?? [];
  return {
    text: renderLessons(licoes),
    injected: licoes.map((l) => ({ tool: l.tool, sintomaHash: l.sintomaHash })),
  };
}

/** Credita o resultado do turno nas lições injetadas. Silencioso: métrica não derruba turno. */
export async function registerOutcomes(
  deps: LearningDeps,
  injected: readonly InjectedLesson[],
  attempts: readonly ToolAttempt[],
): Promise<number> {
  const outcomes = lessonOutcomes(injected, attempts);
  let creditadas = 0;
  for (const o of outcomes) {
    const res = await deps.store.registerOutcome(o.tool, o.sintomaHash, o.acertou);
    if (res.status === 'ok') creditadas += 1;
  }
  return creditadas;
}
