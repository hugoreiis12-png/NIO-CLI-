/**
 * Ligação do aprendizado contínuo com a TUI. Imports **lazy**: o embedder e o pool do
 * Postgres não podem entrar no cold-start do `nio ai` — a sprint de performance
 * mediu que cada import pesa no tempo até o primeiro prompt.
 *
 * Tudo aqui engole o próprio erro por desenho: aprender é acessório.
 */
import type { ChatMessage } from './state.js';
import { tlog } from './debug.js';
import { NIO_LEARN } from '../lib/clients/client-configs.js';
import type { InjectedLesson } from '../app/lesson-outcome.js';

/** Monta as deps sob demanda. `null` quando o aprendizado está desligado. */
export async function learningDeps(): Promise<{
  embedder: import('../core/rag.js').EmbeddingProvider;
  store: import('../core/learning.js').LessonStore;
} | null> {
  if (!NIO_LEARN) return null;
  try {
    const [{ createLocalEmbedder }, { createLessonStore }] = await Promise.all([
      import('../adapters/embed/local-embedder.js'),
      import('../adapters/pg/lesson-repository.js'),
    ]);
    return { embedder: createLocalEmbedder(), store: createLessonStore() };
  } catch (err) {
    tlog('aprendizado indisponível', (err as Error).message);
    return null;
  }
}

/** Fim de turno: grava o que errou-e-depois-acertou. Silencioso. */
export async function learnTurn(messages: readonly ChatMessage[], profile?: string): Promise<number> {
  const deps = await learningDeps();
  if (!deps) return 0;
  try {
    const [{ learnFromAttempts }, { toolAttempts }] = await Promise.all([
      import('../app/learning.js'),
      import('./state.js'),
    ]);
    const res = await learnFromAttempts(deps, toolAttempts(messages), profile);
    if ((res.data ?? 0) > 0) tlog('lições gravadas', String(res.data));
    return res.data ?? 0;
  } catch (err) {
    tlog('aprendizado falhou', (err as Error).message);
    return 0;
  }
}

/**
 * Antes de enviar: pista das tools que **já falharam nesta sessão**. O recorte não é
 * economia — é o que impede a lição de uma ferramenta de contaminar outra.
 */
export async function remindLessons(
  tools: readonly string[],
  texto: string,
): Promise<{ text: string; injected: InjectedLesson[] }> {
  const vazio = { text: '', injected: [] as InjectedLesson[] };
  if (tools.length === 0) return vazio;
  const deps = await learningDeps();
  if (!deps) return vazio;
  try {
    const { lessonsBlock } = await import('../app/learning.js');
    const blocos: string[] = [];
    const injected: InjectedLesson[] = [];
    for (const tool of tools) {
      const b = await lessonsBlock(deps, tool, texto);
      if (b.text) blocos.push(b.text);
      injected.push(...b.injected);
    }
    return { text: blocos.join('\n\n'), injected };
  } catch (err) {
    tlog('recall falhou', (err as Error).message);
    return vazio;
  }
}

/**
 * Fecha o ciclo: credita acerto/erro nas lições injetadas. Sem isto, `usos`/`acertos`
 * ficam em zero para sempre e a poda não distingue lição útil de lição que atrapalha.
 */
export async function creditLessons(
  injected: readonly InjectedLesson[],
  attempts: readonly import('../core/learning.js').ToolAttempt[],
): Promise<number> {
  if (injected.length === 0) return 0;
  const deps = await learningDeps();
  if (!deps) return 0;
  try {
    const { registerOutcomes } = await import('../app/learning.js');
    return await registerOutcomes(deps, injected, attempts);
  } catch (err) {
    tlog('crédito de lição falhou', (err as Error).message);
    return 0;
  }
}
