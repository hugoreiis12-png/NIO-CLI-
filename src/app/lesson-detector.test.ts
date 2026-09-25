import { test, expect } from 'bun:test';
import {
  detectLessons,
  normalizeSintoma,
  sintomaHash,
  lessonEmbeddingText,
  renderLessons,
} from './lesson-detector.js';
import type { ToolAttempt } from '../core/learning.js';

const erro = (tool: string, output: string, input: Record<string, unknown>, reasoning?: string): ToolAttempt =>
  ({ tool, status: 'error', output, input, reasoning });
const ok = (tool: string, input: Record<string, unknown>): ToolAttempt =>
  ({ tool, status: 'completed', output: 'ok', input });

test('ACEITE: errou e depois acertou na mesma tool → vira lição', () => {
  const licoes = detectLessons([
    erro('nio_fabric_query', "Cannot find table 'VENDAS'", { dax: "EVALUATE 'VENDAS'" }, 'assumi que a tabela fosse VENDAS'),
    ok('nio_fabric_query', { dax: "EVALUATE 'VISAO_COMERCIAL'" }),
  ]);

  expect(licoes).toHaveLength(1);
  expect(licoes[0]!.tool).toBe('nio_fabric_query');
  expect(licoes[0]!.causa).toContain('assumi que a tabela fosse VENDAS'); // o reasoning do ERRO
  expect(licoes[0]!.solucao).toContain('VISAO_COMERCIAL');
});

test('ACEITE: mesma entrada dos dois lados é instabilidade, não aprendizado', () => {
  // Erro transitório (rede, timeout) não ensina nada sobre COMO usar a tool.
  const mesmo = { dax: 'EVALUATE X' };
  expect(detectLessons([erro('t', 'timeout', mesmo), ok('t', mesmo)])).toHaveLength(0);
});

test('acerto de OUTRA tool não fecha a lição da que falhou', () => {
  expect(detectLessons([erro('a', 'x', { p: 1 }), ok('b', { p: 2 })])).toHaveLength(0);
});

test('acerto antes da falha não vira lição (ordem importa)', () => {
  expect(detectLessons([ok('t', { p: 1 }), erro('t', 'x', { p: 2 })])).toHaveLength(0);
});

test('falha sem acerto depois fica pendente, não inventa solução', () => {
  expect(detectLessons([erro('t', 'x', { p: 1 })])).toHaveLength(0);
});

test('normalizeSintoma remove o que muda a cada ocorrência do MESMO erro', () => {
  // Sem isto cada 400 com id diferente viraria uma lição nova e o acervo viraria lixo.
  const a = normalizeSintoma('Erro 400 no request 3f2b1a9c-1111-2222-3333-444455556666 às 2026-09-25T10:00:00Z');
  const b = normalizeSintoma('Erro 400 no request 9a8b7c6d-9999-8888-7777-666655554444 às 2026-09-25T11:30:00Z');
  expect(a).toBe(b);
});

test('o hash separa tools diferentes com o mesmo sintoma', () => {
  const s = normalizeSintoma('permission denied');
  expect(sintomaHash('bash', s)).not.toBe(sintomaHash('nio_fabric_query', s));
});

test('duas falhas seguidas: a lição usa a ÚLTIMA antes do acerto', () => {
  const licoes = detectLessons([
    erro('t', 'primeiro erro', { v: 1 }),
    erro('t', 'segundo erro', { v: 2 }),
    ok('t', { v: 3 }),
  ]);
  expect(licoes).toHaveLength(1);
  expect(licoes[0]!.sintoma).toContain('segundo erro');
});

test('texto do embedding junta tool, sintoma e causa (é por ele que o recall acha)', () => {
  const [l] = detectLessons([erro('bash', 'no such file', { cmd: 'a' }, 'supus o caminho'), ok('bash', { cmd: 'b' })]);
  const txt = lessonEmbeddingText(l!);
  expect(txt).toContain('bash');
  expect(txt).toContain('no such file');
  expect(txt).toContain('supus o caminho');
});

test('ACEITE: o bloco injetado é consultivo — sugere, não manda', () => {
  // Medido no RAG de DAX: pergunta errada pontua 0,955 e paráfrase certa 0,928. Não há
  // limiar que separe, então lição NUNCA pode ser aplicada como regra automática.
  const bloco = renderLessons([{ sintoma: 'tabela inexistente', solucao: 'usar VISAO_COMERCIAL' }]);
  expect(bloco).toContain('pista, não como regra');
  expect(bloco).toContain('confira se o caso é mesmo o mesmo');
});

test('sem lição, nenhum bloco é injetado (não polui o prompt)', () => {
  expect(renderLessons([])).toBe('');
});
