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

test('ACEITE: reserva de tabelas garante COLUNAS no contexto, mesmo com o top-k só de medidas', async () => {
  // Cenário real medido: a pergunta cita a tabela, mas o top-k vem 100% de medidas
  // (os nomes delas casam com "ano/2024") e nenhuma coluna chega ao modelo → 400.
  const medidas = Array.from({ length: 5 }, (_, i) =>
    chunk(`medida/M${i}`, `Medida: ${2020 + i}_QTDE | Tabela: VISAO_COMERCIAL`),
  );
  const tabela = chunk('tabela/VISAO_COMERCIAL', 'Tabela: VISAO_COMERCIAL | Colunas: data_lancamento (Date)');

  const search = createSchemaSearch(
    {
      index: makeIndex(medidas),
      byPath: async () => ({ status: 'ok', data: INVENTARIO }),
      topK: 5,
      searchTables: async () => ({ status: 'ok', data: [tabela] }),
    },
    'ds',
  );
  const out = await search([0.1]);

  expect(out.data!.join(' ')).toContain('data_lancamento'); // a coluna chegou
  expect(out.data![0]).toBe(INVENTARIO);
  expect(out.data![1]).toContain('Tabela: VISAO_COMERCIAL'); // tabela antes das medidas
});

test('reserva de tabelas não duplica quando a mesma tabela também ranqueia no top-k', async () => {
  const tabela = chunk('tabela/T', 'Tabela: T | Colunas: c1 (Text)');
  const search = createSchemaSearch(
    {
      index: makeIndex([tabela]),
      byPath: async () => ({ status: 'ok', data: INVENTARIO }),
      topK: 5,
      searchTables: async () => ({ status: 'ok', data: [tabela] }),
    },
    'ds',
  );
  const out = await search([0.1]);
  expect(out.data!.filter((d) => d.startsWith('Tabela: T'))).toHaveLength(1);
});

test('sem searchTables o comportamento antigo se mantém (campo opcional)', async () => {
  const search = createSchemaSearch(
    {
      index: makeIndex([chunk('medida/X', 'Medida: X')]),
      byPath: async () => ({ status: 'ok', data: INVENTARIO }),
      topK: 5,
    },
    'ds',
  );
  const out = await search([0.1]);
  expect(out.data).toHaveLength(2);
});

test('vizinho abaixo do piso de score é descartado (ruído só gasta token)', async () => {
  const bom = { ...chunk('medida/BOM', 'Medida: BOM'), score: 0.75 };
  const ruim = { ...chunk('medida/RUIM', 'Medida: RUIM'), score: 0.31 };
  const search = createSchemaSearch(
    {
      index: makeIndex([bom, ruim]),
      byPath: async () => ({ status: 'ok', data: INVENTARIO }),
      topK: 5,
      minScore: 0.6,
    },
    'ds',
  );
  const out = await search([0.1]);

  expect(out.data!.join(' ')).toContain('BOM');
  expect(out.data!.join(' ')).not.toContain('RUIM');
});

test('chunk gigante é truncado (tabela larga não sequestra o prompt)', async () => {
  const enorme = chunk('tabela/LARGA', 'Tabela: LARGA | Colunas: ' + 'X'.repeat(5000));
  const search = createSchemaSearch(
    {
      index: makeIndex([enorme]),
      byPath: async () => ({ status: 'ok', data: INVENTARIO }),
      topK: 5,
      maxChunkChars: 200,
    },
    'ds',
  );
  const out = await search([0.1]);
  const doc = out.data!.find((d) => d.startsWith('Tabela: LARGA'))!;

  expect(doc.length).toBeLessThanOrEqual(201); // 200 + reticência
  expect(doc.endsWith('…')).toBe(true);
});

test('orçamento total corta os excedentes, mas o inventário sempre entra', async () => {
  const hits = Array.from({ length: 10 }, (_, i) => chunk(`medida/M${i}`, 'Medida: ' + 'Y'.repeat(300)));
  const search = createSchemaSearch(
    {
      index: makeIndex(hits),
      byPath: async () => ({ status: 'ok', data: INVENTARIO }),
      topK: 10,
      maxTotalChars: 800,
    },
    'ds',
  );
  const out = await search([0.1]);
  const total = out.data!.join('').length;

  expect(out.data![0]).toBe(INVENTARIO); // garantido
  expect(total).toBeLessThanOrEqual(900); // orçamento respeitado
  expect(out.data!.length).toBeLessThan(11); // não entraram todos
});

test('escopo: inventário E busca vetorial vão no repo do dataset certo', async () => {
  let pedidoPath = '';
  let pedidoSearch = '';
  const index: DocIndex = {
    indexChunks: async () => ({ status: 'ok', data: 0 }),
    search: async (repo) => {
      pedidoSearch = repo;
      return { status: 'ok', data: [] };
    },
    indexedRefs: async () => ({ status: 'ok', data: [] }),
  };
  const search = createSchemaSearch(
    {
      index,
      byPath: async (repo) => {
        pedidoPath = repo;
        return { status: 'ok', data: null };
      },
      topK: 5,
    },
    'ds-A',
  );
  await search([0.1]);

  expect(pedidoPath).toBe('model:ds-A');
  // regressão: a busca vetorial rodava SEM filtro de repo e varria todos os modelos
  expect(pedidoSearch).toBe('model:ds-A');
});
