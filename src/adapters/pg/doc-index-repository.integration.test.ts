/**
 * Integração do `DocIndex` contra o Postgres real com pgvector.
 *
 * O teste que justifica este arquivo é o **isolamento entre modelos**: a busca vetorial
 * rodava sem `WHERE repo`, varrendo todos os acervos. Com um só dataset indexado isso
 * passava despercebido; com vários, a tabela de um modelo vaza no contexto de outro e o
 * DAX gerado referencia nome inexistente — exatamente o 400 que o índice existe pra matar.
 *
 * Gated em `NIO_DATABASE_URL` + schema do RAG presente (pgvector + migration 0010).
 */
import { test, expect, afterAll } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { createDocIndexRepository, countChunks } from './doc-index-repository.js';
import { EMBEDDING_DIMS } from '../../core/rag.js';
import type { DocChunk } from '../../core/rag.js';
import { query, closePool } from './client.js';

const hasDb = Boolean(process.env.NIO_DATABASE_URL);

async function ragSchemaReady(): Promise<boolean> {
  if (!hasDb) return false;
  try {
    await query('SELECT 1 FROM dax_doc_chunk LIMIT 1');
    return true;
  } catch {
    return false;
  }
}

const ragReady = await ragSchemaReady();
if (hasDb && !ragReady) {
  console.warn('  [skip] schema do RAG ausente — testes de DocIndex pulados');
}
const dbTest = ragReady ? test : test.skip;

/** Dois acervos descartáveis, um por "modelo". */
const REPO_A = `model:test-A-${randomUUID()}`;
const REPO_B = `model:test-B-${randomUUID()}`;

/** One-hot: `hot(0)` e `hot(7)` são ortogonais. */
const hot = (i: number): number[] =>
  Array.from({ length: EMBEDDING_DIMS }, (_, k) => (k === i ? 1 : 0));

const chunk = (repo: string, path: string, content: string): DocChunk => ({
  repo,
  ref: 'r1',
  path,
  content,
});

afterAll(async () => {
  if (!hasDb) return;
  if (ragReady) {
    await query('DELETE FROM dax_doc_chunk WHERE repo = ANY($1)', [[REPO_A, REPO_B]]).catch(() => {});
  }
  await closePool().catch(() => {});
});

dbTest('ACEITE: busca de um modelo NUNCA devolve chunk de outro', async () => {
  const repo = createDocIndexRepository();

  // Mesmo vetor nos dois acervos — só o filtro de repo separa.
  await repo.indexChunks([chunk(REPO_A, 'tabela/VENDAS_A', 'Tabela: VENDAS_A')], [hot(0)]);
  await repo.indexChunks([chunk(REPO_B, 'tabela/COMPRAS_B', 'Tabela: COMPRAS_B')], [hot(0)]);

  const emA = await repo.search(REPO_A, hot(0), 10);
  expect(emA.status).toBe('ok');
  const textosA = (emA.data ?? []).map((c) => c.content).join(' ');
  expect(textosA).toContain('VENDAS_A');
  expect(textosA).not.toContain('COMPRAS_B'); // o vazamento que causava 400

  const emB = await repo.search(REPO_B, hot(0), 10);
  const textosB = (emB.data ?? []).map((c) => c.content).join(' ');
  expect(textosB).toContain('COMPRAS_B');
  expect(textosB).not.toContain('VENDAS_A');
});

dbTest('reingestão do mesmo conteúdo é idempotente (ON CONFLICT DO NOTHING)', async () => {
  const repo = createDocIndexRepository();
  const c = [chunk(REPO_A, 'tabela/IDEM', 'Tabela: IDEM')];

  const antes = await countChunks(REPO_A);
  const um = await repo.indexChunks(c, [hot(1)]);
  const dois = await repo.indexChunks(c, [hot(1)]);
  const depois = await countChunks(REPO_A);

  expect(um.data).toBe(1);
  expect(dois.data).toBe(0); // segunda vez não insere nada
  expect((depois.data ?? 0) - (antes.data ?? 0)).toBe(1);
});

dbTest('indexedRefs é por modelo', async () => {
  const repo = createDocIndexRepository();
  await repo.indexChunks([{ ...chunk(REPO_A, 'tabela/REF', 'Tabela: REF'), ref: 'ref-A' }], [hot(2)]);

  const refsA = await repo.indexedRefs(REPO_A);
  const refsB = await repo.indexedRefs(REPO_B);
  expect(refsA.data).toContain('ref-A');
  expect(refsB.data).not.toContain('ref-A');
});

dbTest('descasamento chunks/embeddings é recusado antes de escrever', async () => {
  const repo = createDocIndexRepository();
  const out = await repo.indexChunks([chunk(REPO_A, 'x', 'x'), chunk(REPO_A, 'y', 'y')], [hot(3)]);
  expect(out.status).toBe('failed');
  expect(out.error).toContain('2 chunks para 1 embeddings');
});

dbTest('embedding com dimensão errada é recusado', async () => {
  const repo = createDocIndexRepository();
  const out = await repo.indexChunks([chunk(REPO_A, 'z', 'z')], [[1, 2, 3]]);
  expect(out.status).toBe('failed');
  expect(out.error).toContain('768');
});
