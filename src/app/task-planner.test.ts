/**
 * Planner sem rede: o `complete` é injetado. Cobre o contrato (goal → steps),
 * a resiliência a como o modelo realmente responde, e a invariante de segurança
 * de que só o `goal` entra no prompt.
 */
import { test, expect } from 'bun:test';
import { createTaskPlanner, buildPlanPrompt, clampSteps } from './task-planner.js';
import { LlmJsonError } from './llm-json.js';
import type { Task } from '../core/tasks.js';

function fakeTask(goal: string, maxSteps = 25): Task {
  return {
    id: 'abc12345',
    sessionId: null,
    userId: 1,
    profile: 'bi',
    goal,
    status: 'planning',
    currentStep: null,
    maxSteps,
    workingSet: {},
    engineSessionId: null,
    result: null,
    error: null,
    attempts: 0,
    fence: 1,
    lockedBy: 'w1',
    lockedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: null,
    awaitingKind: null,
    awaitingSubject: null,
    approvedTools: [],
    kind: 'agent',
  };
}

const PLANO_OK = JSON.stringify({
  steps: [
    { name: 'localizar contratos', instruction: 'buscar os contratos de 2026', tool_hint: 'grep' },
    { name: 'extrair cláusulas', instruction: 'extrair as cláusulas de renovação' },
  ],
});

test('goal vira steps, com toolHint opcional', async () => {
  const planner = createTaskPlanner({ complete: async () => PLANO_OK });
  const steps = await planner.plan(fakeTask('analisar contratos'));

  expect(steps).toHaveLength(2);
  expect(steps[0]!.name).toBe('localizar contratos');
  expect(steps[0]!.toolHint).toBe('grep');
  // Sem `tool_hint` no JSON, a propriedade não existe — não vira `undefined` solto.
  expect('toolHint' in steps[1]!).toBe(false);
});

test('aguenta cerca de markdown e cortesia antes do JSON', async () => {
  const sujo = `Claro, aqui está o plano:\n\`\`\`json\n${PLANO_OK}\n\`\`\`\nEspero ter ajudado!`;
  const planner = createTaskPlanner({ complete: async () => sujo });
  expect(await planner.plan(fakeTask('x'))).toHaveLength(2);
});

test('resposta sem JSON ou fora do shape lança tipado', async () => {
  const semJson = createTaskPlanner({ complete: async () => 'não vou responder em JSON' });
  await expect(semJson.plan(fakeTask('x'))).rejects.toBeInstanceOf(LlmJsonError);

  // `steps` presente mas com item sem `instruction` — shape errado tem que falhar.
  const shapeErrado = createTaskPlanner({
    complete: async () => JSON.stringify({ steps: [{ name: 'só nome' }] }),
  });
  await expect(shapeErrado.plan(fakeTask('x'))).rejects.toBeInstanceOf(LlmJsonError);
});

test('plano maior que o teto da task é cortado', async () => {
  const gigante = JSON.stringify({
    steps: Array.from({ length: 20 }, (_, i) => ({ name: `p${i}`, instruction: 'faz' })),
  });
  const planner = createTaskPlanner({ complete: async () => gigante });
  // O modelo ignorou o limite do prompt; o clamp é a defesa real.
  expect(await planner.plan(fakeTask('x', 3))).toHaveLength(3);
});

test('clampSteps nunca devolve zero passos nem passa do teto duro', () => {
  const dez = Array.from({ length: 10 }, (_, i) => ({ name: `p${i}`, instruction: 'faz' }));
  expect(clampSteps(dez, 0)).toHaveLength(1); // teto absurdo não pode zerar o plano
  expect(clampSteps(dez, 99)).toHaveLength(10);
});

test('SEGURANÇA: o prompt do planner é só goal + perfil + teto, nada mais', () => {
  // Igualdade exata, não `toContain`: qualquer conteúdo novo no prompt quebra
  // este teste. É o ponto — acrescentar um canal de contexto aqui (saída de
  // step, documento lido) reabre o vetor de prompt injection que o Planner
  // existe para não ter. Quebrou? Justifique antes de atualizar o esperado.
  expect(buildPlanPrompt('analisar contratos', 'bi', 25)).toBe(
    [
      'Perfil do ambiente: bi',
      'Limite de passos: 12',
      '',
      'Objetivo do usuário:',
      'analisar contratos',
    ].join('\n'),
  );
});
