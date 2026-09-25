/**
 * Decide se a lição injetada ajudou. Puro: sem IO.
 *
 * Sem isto, `usos` e `acertos` nunca saem de zero e a poda não tem dado para trabalhar
 * — o acervo cresceria para sempre, inclusive com lição ruim, que é pior que lição
 * nenhuma porque aparece no prompt com ar de autoridade.
 *
 * Regra de justiça: lição cuja ferramenta **nem foi chamada** no turno seguinte não
 * conta nem a favor nem contra. Ela não teve chance; penalizá-la podaria lição boa.
 */
import type { ToolAttempt } from '../core/learning.js';

export interface InjectedLesson {
  tool: string;
  sintomaHash: string;
}

export interface LessonOutcome extends InjectedLesson {
  /** A ferramenta rodou sem erro no turno seguinte. */
  acertou: boolean;
}

const errou = (a: ToolAttempt): boolean => a.status === 'error' || a.status === 'failed';

/**
 * Cruza as lições injetadas com o que aconteceu **depois** delas.
 * `attempts` deve conter só as tentativas do turno seguinte à injeção.
 */
export function lessonOutcomes(
  injected: readonly InjectedLesson[],
  attempts: readonly ToolAttempt[],
): LessonOutcome[] {
  const out: LessonOutcome[] = [];
  for (const licao of injected) {
    const daFerramenta = attempts.filter((a) => a.tool === licao.tool);
    if (daFerramenta.length === 0) continue; // não teve chance → não pontua
    out.push({ ...licao, acertou: !daFerramenta.some(errou) });
  }
  return out;
}
