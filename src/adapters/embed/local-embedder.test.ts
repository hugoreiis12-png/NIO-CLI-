/**
 * Contrato do embedder local. O que importa aqui não é a qualidade do vetor (isso
 * é gate de recall, com o modelo baixado) e sim as **garantias de robustez**: a
 * dependência é opcional, então nada pode lançar nem quebrar o CLI quando ela falta.
 */
import { test, expect } from 'bun:test';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createLocalEmbedder, embedderStatus } from './local-embedder.js';

/** A optionalDependency está instalada neste ambiente? */
const hasDep = existsSync(new URL('../../../node_modules/@huggingface', import.meta.url));
/** O modelo já está no cache em disco? Sem isso, carregar dispararia ~280MB de download. */
const modelCached = existsSync(join(homedir(), '.nio', 'models', 'Xenova'));
/**
 * Carregar o modelo custa 266MB de I/O e satura CPU — rodar isso na suíte inteira fez
 * testes vizinhos estourarem timeout por contenção. Então é **opt-in explícito**:
 *
 *   NIO_TEST_EMBEDDER=1 bun test src/adapters/embed/
 *
 * Sem o flag (o caso normal e o do CI), só rodam as asserções que não carregam nada.
 */
const optIn = process.env.NIO_TEST_EMBEDDER === '1';
const loadTest = optIn && hasDep && modelCached ? test : test.skip;

test('embedPassages([]) não carrega o modelo e devolve vazio', async () => {
  // Curto-circuito antes do load: vale com ou sem a dependência instalada.
  const out = await createLocalEmbedder().embedPassages([]);
  expect(out.status).toBe('ok');
  expect(out.data).toEqual([]);
});

loadTest('nunca lança — falha vira RagResult com status conhecido', async () => {
  const out = await createLocalEmbedder().embedQuery('qual o total de vendas');
  expect(['ok', 'unavailable', 'unconfigured', 'failed']).toContain(out.status);
});

loadTest('com o modelo em cache: vetor de 768 dims e normalizado', async () => {
  if (!modelCached) return; // sem cache, a asserção abaixo não se aplica
  const out = await createLocalEmbedder().embedQuery('qual o total de vendas');
  expect(out.status).toBe('ok');
  expect(out.data).toHaveLength(768);
  const norma = Math.sqrt(out.data!.reduce((s, v) => s + v * v, 0));
  expect(norma).toBeCloseTo(1, 3); // normalize:true → cosseno vira produto escalar
});

const noDepTest = hasDep ? test.skip : test;

noDepTest('sem a dependência: unconfigured com mensagem acionável (CLI segue vivo)', async () => {
  const out = await createLocalEmbedder().embedQuery('qual o total de vendas');
  expect(out.status).toBe('unconfigured');
  expect(out.error).toContain('nio fabric rag setup');
  expect(out.data).toBeUndefined();
});

noDepTest('sem a dependência: embedderStatus também reporta unconfigured', async () => {
  const out = await embedderStatus();
  expect(out.status).toBe('unconfigured');
});
