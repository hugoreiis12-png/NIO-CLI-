/**
 * Detecta a lição num par "errou → acertou" da MESMA tool. Puro: sem IO, sem modelo.
 *
 * Por que determinístico e não perguntando ao modelo: medimos nesta sprint que o modelo
 * ignora instrução com frequência (a política de perguntar só passou a valer depois de
 * duas reescritas). Falha de tool, ao contrário, é um fato estruturado no stream — dá
 * pra ler sem pedir licença a ninguém.
 */
import { createHash } from 'node:crypto';
import type { Lesson, ToolAttempt } from '../core/learning.js';

/** Teto por campo — lição é dica curta, não transcrição de sessão. */
const MAX_CAMPO = 600;

const clamp = (t: string, n = MAX_CAMPO): string => (t.length > n ? `${t.slice(0, n)}…` : t);

/**
 * Normaliza o erro para deduplicar: tira ids, GUIDs, números e horários, que mudam a
 * cada ocorrência do MESMO erro. Sem isso cada 400 viraria uma lição nova.
 */
export function normalizeSintoma(erro: string): string {
  return erro
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<guid>')
    .replace(/\d{4}-\d{2}-\d{2}[t ][\d:.]+z?/g, '<ts>')
    .replace(/\b\d+\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CAMPO);
}

export function sintomaHash(tool: string, sintoma: string): string {
  return createHash('sha256').update(tool).update('\u0000').update(sintoma).digest('hex').slice(0, 16);
}

const falhou = (a: ToolAttempt): boolean => a.status === 'error' || a.status === 'failed';
const passou = (a: ToolAttempt): boolean => a.status === 'completed' || a.status === 'ok';

/** Descrição curta do que mudou entre a tentativa que falhou e a que funcionou. */
function descreverSolucao(erro: ToolAttempt, ok: ToolAttempt): string {
  const antes = JSON.stringify(erro.input ?? {});
  const depois = JSON.stringify(ok.input ?? {});
  if (antes === depois) {
    // Mesma entrada e outro resultado = intermitência, não lição de uso.
    return '';
  }
  return clamp(`Funcionou com: ${depois}`);
}

/**
 * Varre a sequência de chamadas e devolve as lições. Só considera par da **mesma tool**
 * em que a falha vem antes do acerto; entrada idêntica nos dois é descartada (foi
 * instabilidade, não aprendizado).
 */
export function detectLessons(attempts: readonly ToolAttempt[], profile?: string): Lesson[] {
  const licoes: Lesson[] = [];
  const pendentes = new Map<string, ToolAttempt>();

  for (const a of attempts) {
    if (falhou(a)) {
      pendentes.set(a.tool, a); // a mais recente é a que importa
      continue;
    }
    if (!passou(a)) continue;
    const erro = pendentes.get(a.tool);
    if (!erro) continue;
    pendentes.delete(a.tool);

    const solucao = descreverSolucao(erro, a);
    if (!solucao) continue;

    const sintoma = normalizeSintoma(erro.output);
    if (!sintoma) continue;

    licoes.push({
      tool: a.tool,
      profile,
      sintoma,
      sintomaHash: sintomaHash(a.tool, sintoma),
      // O raciocínio do turno que ERROU é a causa; o do acerto já é consequência.
      causa: erro.reasoning ? clamp(erro.reasoning) : undefined,
      solucao,
    });
  }
  return licoes;
}

/** Texto que vai para o embedding — é por ele que o recall encontra a lição. */
export function lessonEmbeddingText(lesson: Lesson): string {
  return [lesson.tool, lesson.sintoma, lesson.causa ?? ''].filter(Boolean).join('\n');
}

/** Bloco injetado no prompt. Consultivo por construção: sugere, não manda. */
export function renderLessons(lessons: readonly { sintoma: string; solucao: string }[]): string {
  if (lessons.length === 0) return '';
  const linhas = lessons.map((l) => `- Já falhou assim: ${l.sintoma}\n  O que funcionou: ${l.solucao}`);
  return [
    'Erros parecidos já aconteceram nesta ferramenta. Use como pista, não como regra —',
    'confira se o caso é mesmo o mesmo antes de aplicar:',
    ...linhas,
  ].join('\n');
}
