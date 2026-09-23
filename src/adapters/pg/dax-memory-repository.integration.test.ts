/**
 * Integração do `DaxMemory` contra o Postgres real com pgvector — o cache semântico
 * que evita regerar um DAX já validado. Cobre os dois modos de busca (hit exato e
 * vizinho por cosseno), o **isolamento por modelo semântico** e o upsert.
 *
 * Gated em `NIO_DATABASE_URL` (sem banco → pula). Usa um workspace descartável e
 * apaga tudo no fim.
 */
import { test, expect, afterAll } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { createDaxMemoryRepository } from './dax-memory-repository.js';
import { EMBEDDING_DIMS } from '../../core/rag.js';
import { normalizeQuestion } from '../../app/rag-templates.js';
import { query, closePool } from './client.js';

const hasDb = Boolean(process.env.NIO_DATABASE_URL);

/**
 * As tabelas do RAG existem neste banco? Elas dependem de **pgvector no host** e da
 * migration 0010. Um ambiente sem isso é falta de infraestrutura, não regressão de
 * código — então pula com aviso em vez de derrubar a suíte inteira.
 */
async function ragSchemaReady(): Promise<boolean> {
  if (!hasDb) return false;
  try {
    await query('SELECT 1 FROM dax_query_template LIMIT 1');
    return true;
  } catch {
    return false;
  }
}

const ragReady = await ragSchemaReady();
if (hasDb && !ragReady) {
  console.warn('  [skip] tabelas do RAG ausentes (pgvector + migration 0010) — testes de DaxMemory pulados');
}
const dbTest = ragReady ? test : test.skip;

/** Workspace descartável — isola esta execução e facilita a limpeza. */
const WS = `test-ws-${randomUUID()}`;
const DS = 'test-ds';

/** Vetor one-hot de 768 dims: `hot(0)` e `hot(5)` são ortogonais (cosseno 0). */
const hot = (i: number): number[] =>
  Array.from({ length: EMBEDDING_DIMS }, (_, k) => (k === i ? 1 : 0));

afterAll(async () => {
  if (!hasDb) return;
  // Só limpa o que foi criado; com o schema ausente não há nada (e a query falharia).
  if (ragReady) {
    await query('DELETE FROM dax_query_template WHERE workspace_id = $1', [WS]).catch(() => {});
  }
  await closePool().catch(() => {});
});

dbTest('DaxMemory: grava, acha por hit exato e por similaridade', async () => {
  const repo = createDaxMemoryRepository();
  const questionNorm = normalizeQuestion('Qual o total de vendas?');

  const saved = await repo.remember(
    {
      requestName: 'total de vendas',
      questionNorm,
      workspaceId: WS,
      datasetId: DS,
      dax: 'EVALUATE ROW("Total", 42)',
      outputSummary: { rowCount: 1, columns: ['[Total]'], sample: [{ '[Total]': 42 }] },
    },
    hot(0),
  );
  expect(saved.status).toBe('ok');

  // 1) hit exato — sem custo de vetor
  const exact = await repo.findByQuestion(questionNorm, WS, DS);
  expect(exact.status).toBe('ok');
  expect(exact.data?.dax).toBe('EVALUATE ROW("Total", 42)');
  expect(exact.data?.score).toBe(1);
  expect(exact.data?.outputSummary.rowCount).toBe(1); // jsonb volta estruturado

  // 2) similaridade — o mesmo vetor tem cosseno 1
  const near = await repo.findSimilar(hot(0), WS, DS, 0.9);
  expect(near.status).toBe('ok');
  expect(near.data?.dax).toBe('EVALUATE ROW("Total", 42)');
  expect(near.data!.score).toBeGreaterThan(0.99);
});

dbTest('DaxMemory: abaixo do limiar NÃO serve o template (evita DAX errado)', async () => {
  const repo = createDaxMemoryRepository();
  await repo.remember(
    {
      requestName: 'ancora',
      questionNorm: normalizeQuestion(`ancora ${randomUUID()}`),
      workspaceId: WS,
      datasetId: DS,
      dax: 'EVALUATE ROW("X", 1)',
      outputSummary: { rowCount: 1, columns: ['[X]'], sample: [] },
    },
    hot(0),
  );
  // vetor ortogonal → cosseno 0, muito abaixo de 0.9
  const far = await repo.findSimilar(hot(5), WS, DS, 0.9);
  expect(far.status).toBe('ok');
  expect(far.data).toBeNull();
});

dbTest('DaxMemory: escopo por dataset isola — DAX de um modelo não vaza pro outro', async () => {
  const repo = createDaxMemoryRepository();
  const questionNorm = normalizeQuestion(`vendas ${randomUUID()}`);
  await repo.remember(
    {
      requestName: 'vendas',
      questionNorm,
      workspaceId: WS,
      datasetId: 'dataset-A',
      dax: "EVALUATE 'VendasA'",
      outputSummary: { rowCount: 0, columns: [], sample: [] },
    },
    hot(0),
  );

  // mesmo vetor e mesma pergunta, porém OUTRO dataset → não pode achar
  const other = await repo.findSimilar(hot(0), WS, 'dataset-B', 0.9);
  expect(other.data).toBeNull();
  const otherExact = await repo.findByQuestion(questionNorm, WS, 'dataset-B');
  expect(otherExact.data).toBeNull();
});

dbTest('DaxMemory: mesma pergunta regrava (upsert), não duplica', async () => {
  const repo = createDaxMemoryRepository();
  const questionNorm = normalizeQuestion(`upsert ${randomUUID()}`);
  const base = {
    requestName: 'upsert',
    questionNorm,
    workspaceId: WS,
    datasetId: DS,
    outputSummary: { rowCount: 0, columns: [], sample: [] },
  };

  const first = await repo.remember({ ...base, dax: 'EVALUATE ROW("v", 1)' }, hot(1));
  const second = await repo.remember({ ...base, dax: 'EVALUATE ROW("v", 2)' }, hot(1));
  expect(second.data).toBe(first.data!); // mesmo id → atualizou, não inseriu

  const found = await repo.findByQuestion(questionNorm, WS, DS);
  expect(found.data?.dax).toBe('EVALUATE ROW("v", 2)'); // vence a última execução boa

  const hit = await repo.markHit(found.data!.id);
  expect(hit.status).toBe('ok');
});

dbTest('DaxMemory: embedding com dimensão errada é recusado antes do INSERT', async () => {
  const repo = createDaxMemoryRepository();
  const out = await repo.remember(
    {
      requestName: 'dim',
      questionNorm: normalizeQuestion(`dim ${randomUUID()}`),
      workspaceId: WS,
      datasetId: DS,
      dax: 'EVALUATE ROW("x", 1)',
      outputSummary: { rowCount: 0, columns: [], sample: [] },
    },
    [1, 2, 3], // 3 dims, não 768
  );
  expect(out.status).toBe('failed');
  expect(out.error).toContain('768');
});
