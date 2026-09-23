import { test, expect } from 'bun:test';
import { createSchemaSearch } from './schema-search.js';
import { INVENTORY_PATH, schemaRepo } from './schema-chunker.js';
import type { DocIndex, ScoredChunk } from '../core/rag.js';

const chunk = (path: string, content: string): ScoredChunk => ({
  repo: schemaRepo('ds'),
  ref: 'r',
  path,
  content,
  score: 0.8,
});

function makeIndex(hits: ScoredChunk[], status: 'ok' | 'failed' = 'ok'): DocIndex {
  return {
    indexChunks: async () => ({ status: 'ok', data: 0 }),
    search: async () =>
      status === 'ok' ? { status: 'ok', data: hits } : { status: 'failed', error: 'banco fora' },
    indexedRefs: async () => ({ status: 'ok', data: [] }),
  };
}

const INVENTARIO = 'Tabelas do modelo semântico (2): VISAO_COMERCIAL, CALENDARIO';

test('inventário de tabelas vem SEMPRE, e primeiro', async () => {
  const search = createSchemaSearch(
    {
      index: makeIndex([chunk('medida/X', 'Medida: TOTAL_LIQUIDO')]),
      byPath: async () => ({ status: 'ok', data: INVENTARIO }),
      topK: 5,
    },
    'ds',
  );
  const out = await search([0.1]);

  expect(out.status).toBe('ok');
  expect(out.data![0]).toBe(INVENTARIO); // garantido, não sujeito ao ranking
  expect(out.data).toContain('Medida: TOTAL_LIQUIDO');
});

test('não duplica o inventário se ele também ranquear no top-k', async () => {
  const search = createSchemaSearch(
    {
      index: makeIndex([chunk(INVENTORY_PATH, INVENTARIO), chunk('medida/X', 'Medida: X')]),
      byPath: async () => ({ status: 'ok', data: INVENTARIO }),
      topK: 5,
    },
    'ds',
  );
  const out = await search([0.1]);

  expect(out.data!.filter((d) => d === INVENTARIO)).toHaveLength(1);
});

test('acervo vazio (schema nunca sincronizado) → lista vazia, não erro', async () => {
  const search = createSchemaSearch(
    { index: makeIndex([]), byPath: async () => ({ status: 'ok', data: null }), topK: 5 },
    'ds',
  );
  const out = await search([0.1]);

  expect(out.status).toBe('ok'); // degradar é melhor que travar a geração
  expect(out.data).toEqual([]);
});

test('busca falha mas o inventário existe → segue com o inventário', async () => {
  const search = createSchemaSearch(
    {
      index: makeIndex([], 'failed'),
      byPath: async () => ({ status: 'ok', data: INVENTARIO }),
      topK: 5,
    },
    'ds',
  );
  const out = await search([0.1]);

  expect(out.status).toBe('ok');
  expect(out.data).toEqual([INVENTARIO]);
});

test('busca falha e não há inventário → propaga a falha', async () => {
  const search = createSchemaSearch(
    { index: makeIndex([], 'failed'), byPath: async () => ({ status: 'ok', data: null }), topK: 5 },
    'ds',
  );
  const out = await search([0.1]);

  expect(out.status).toBe('failed');
});

test('escopo: o inventário é buscado no repo do dataset certo', async () => {
  let pedido = '';
  const search = createSchemaSearch(
    {
      index: makeIndex([]),
      byPath: async (repo) => {
        pedido = repo;
        return { status: 'ok', data: null };
      },
      topK: 5,
    },
    'ds-A',
  );
  await search([0.1]);

  expect(pedido).toBe('model:ds-A');
});
