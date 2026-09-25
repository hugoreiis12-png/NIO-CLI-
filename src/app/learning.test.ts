import { test, expect } from 'bun:test';
import { learnFromAttempts, recallLessons, lessonsBlock } from './learning.js';
import type { LessonStore, ScoredLesson, ToolAttempt } from '../core/learning.js';
import type { EmbeddingProvider } from '../core/rag.js';

const VETOR = Array.from({ length: 768 }, () => 0.1);

const embedder = (ok = true): EmbeddingProvider => ({
  embedQuery: async () => (ok ? { status: 'ok', data: VETOR } : { status: 'unconfigured', error: 'sem modelo' }),
  embedPassages: async (t) => (ok ? { status: 'ok', data: t.map(() => VETOR) } : { status: 'unconfigured', error: 'sem modelo' }),
});

function fakeStore(achadas: ScoredLesson[] = []) {
  const gravadas: unknown[] = [];
  const store: LessonStore = {
    save: async (l) => { gravadas.push(l); return { status: 'ok', data: gravadas.length }; },
    recall: async () => ({ status: 'ok', data: achadas }),
    registerOutcome: async () => ({ status: 'ok' }),
  };
  return { store, gravadas };
}

const licao = (score: number): ScoredLesson => ({
  tool: 'nio_fabric_query',
  sintoma: 'tabela inexistente',
  sintomaHash: 'h1',
  solucao: 'usar VISAO_COMERCIAL',
  score,
  usos: 1,
  acertos: 1,
});

const par: ToolAttempt[] = [
  { tool: 'nio_fabric_query', status: 'error', output: "Cannot find table 'VENDAS'", input: { dax: 'a' }, reasoning: 'supus VENDAS' },
  { tool: 'nio_fabric_query', status: 'completed', output: 'ok', input: { dax: 'b' } },
];

test('ACEITE: par errou→acertou vira lição gravada', async () => {
  const { store, gravadas } = fakeStore();
  const res = await learnFromAttempts({ embedder: embedder(), store }, par, 'bi');

  expect(res.status).toBe('ok');
  expect(res.data).toBe(1);
  expect((gravadas[0] as { causa: string }).causa).toContain('supus VENDAS');
});

test('turno sem nada a aprender devolve 0, não erro', async () => {
  const { store } = fakeStore();
  const res = await learnFromAttempts({ embedder: embedder(), store }, [], undefined);
  expect(res).toEqual({ status: 'ok', data: 0 });
});

test('ACEITE: embedder fora NÃO derruba nada — degrada e reporta', async () => {
  // Aprender é acessório; responder é a função. O usuário não pode nem perceber.
  const { store, gravadas } = fakeStore();
  const res = await learnFromAttempts({ embedder: embedder(false), store }, par);
  expect(res.status).toBe('unconfigured');
  expect(gravadas).toHaveLength(0);
});

test('ACEITE: lição abaixo do piso de score é descartada', async () => {
  // 0,80 < piso 0,82. Lição irrelevante desvia o modelo com ar de autoridade.
  const { store } = fakeStore([licao(0.95), licao(0.8)]);
  const res = await recallLessons({ embedder: embedder(), store }, 'nio_fabric_query', 'erro x');
  expect(res.data).toHaveLength(1);
  expect(res.data![0]!.score).toBe(0.95);
});

test('bloco do prompt sai consultivo, nunca imperativo', async () => {
  const { store } = fakeStore([licao(0.95)]);
  const { text: bloco, injected } = await lessonsBlock({ embedder: embedder(), store }, 'nio_fabric_query', 'erro x');
  expect(bloco).toContain('pista, não como regra');
  expect(bloco).toContain('VISAO_COMERCIAL');
  expect(injected).toEqual([{ tool: 'nio_fabric_query', sintomaHash: 'h1' }]); // pra creditar depois
});

test('sem lição acima do piso, nenhum bloco entra no prompt', async () => {
  const { store } = fakeStore([licao(0.5)]);
  expect((await lessonsBlock({ embedder: embedder(), store }, 't', 'x')).text).toBe('');
});

test('banco fora → bloco vazio, sem propagar erro pro turno', async () => {
  const store: LessonStore = {
    save: async () => ({ status: 'unavailable', error: 'banco fora' }),
    recall: async () => ({ status: 'unavailable', error: 'banco fora' }),
    registerOutcome: async () => ({ status: 'ok' }),
  };
  expect((await lessonsBlock({ embedder: embedder(), store }, 't', 'x')).text).toBe('');
});
