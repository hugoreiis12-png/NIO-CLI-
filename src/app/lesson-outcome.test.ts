import { test, expect } from 'bun:test';
import { lessonOutcomes } from './lesson-outcome.js';
import type { ToolAttempt } from '../core/learning.js';

const LICAO = { tool: 'nio_fabric_query', sintomaHash: 'h1' };
const att = (tool: string, status: string): ToolAttempt => ({ tool, status, output: '' });

test('ACEITE: ferramenta rodou sem erro depois da lição → acerto', () => {
  expect(lessonOutcomes([LICAO], [att('nio_fabric_query', 'completed')])).toEqual([
    { ...LICAO, acertou: true },
  ]);
});

test('ACEITE: errou de novo na mesma ferramenta → a lição não ajudou', () => {
  expect(lessonOutcomes([LICAO], [att('nio_fabric_query', 'error')])).toEqual([
    { ...LICAO, acertou: false },
  ]);
});

test('ACEITE: ferramenta nem foi chamada → não pontua (não teve chance)', () => {
  // Penalizar aqui podaria lição boa só porque o turno seguinte foi sobre outra coisa.
  expect(lessonOutcomes([LICAO], [att('bash', 'completed')])).toEqual([]);
});

test('um erro entre vários acertos ainda conta como não-ajudou', () => {
  const attempts = [
    att('nio_fabric_query', 'completed'),
    att('nio_fabric_query', 'error'),
    att('nio_fabric_query', 'completed'),
  ];
  expect(lessonOutcomes([LICAO], attempts)[0]!.acertou).toBe(false);
});

test('lições de ferramentas diferentes são avaliadas separadamente', () => {
  const injetadas = [LICAO, { tool: 'bash', sintomaHash: 'h2' }];
  const attempts = [att('nio_fabric_query', 'completed'), att('bash', 'error')];
  const r = lessonOutcomes(injetadas, attempts);
  expect(r).toHaveLength(2);
  expect(r.find((x) => x.tool === 'nio_fabric_query')!.acertou).toBe(true);
  expect(r.find((x) => x.tool === 'bash')!.acertou).toBe(false);
});

test('nada injetado → nada a registrar', () => {
  expect(lessonOutcomes([], [att('bash', 'error')])).toEqual([]);
});
