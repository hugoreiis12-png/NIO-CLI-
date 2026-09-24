/**
 * Contrato da indexação sob demanda. O ganho que importa: dataset já indexado **não**
 * relê o schema (3 chamadas REST) nem reembeda — só a primeira pergunta de cada modelo
 * paga o custo.
 */
import { test, expect } from 'bun:test';
import { ensureSchemaIndexed } from './ensure-schema.js';
import type { SchemaIngestDeps } from './schema-ingest.js';
import type { FabricGateway, FabricRow } from '../core/fabric.js';
import type { DocIndex, EmbeddingProvider } from '../core/rag.js';

const TABLES: FabricRow[] = [{ '[Name]': 'VENDAS', '[IsHidden]': 'false' }];

interface Spy {
  daxRun: string[];
  embedded: number;
  refsPedidos: string[];
}

function makeDeps(opts: { refs?: string[]; refsFail?: boolean } = {}): {
  deps: SchemaIngestDeps;
  spy: Spy;
} {
  const spy: Spy = { daxRun: [], embedded: 0, refsPedidos: [] };

  const fabric: FabricGateway = {
    listWorkspaces: async () => ({ status: 'ok', data: [] }),
    listDatasets: async () => ({ status: 'ok', data: [] }),
    executeDax: async (_w, _d, dax) => {
      spy.daxRun.push(dax);
      return { status: 'ok', data: dax.includes('TABLES') ? TABLES : [] };
    },
  };
  const embedder: EmbeddingProvider = {
    embedQuery: async () => ({ status: 'ok', data: [] }),
    embedPassages: async (t) => {
      spy.embedded += 1;
      return { status: 'ok', data: t.map(() => [0.1]) };
    },
  };
  const index: DocIndex = {
    indexChunks: async (c) => ({ status: 'ok', data: c.length }),
    search: async () => ({ status: 'ok', data: [] }),
    indexedRefs: async (repo) => {
      spy.refsPedidos.push(repo);
      return opts.refsFail
        ? { status: 'unavailable', error: 'banco fora' }
        : { status: 'ok', data: opts.refs ?? [] };
    },
  };
  return { deps: { fabric, embedder, index }, spy };
}

const input = { workspaceId: 'ws', datasetId: 'ds-novo' };

test('dataset nunca indexado → indexa agora', async () => {
  const { deps, spy } = makeDeps({ refs: [] });
  const out = await ensureSchemaIndexed(deps, input);

  expect(out.status).toBe('ok');
  expect(out.data).toBe('indexado-agora');
  expect(spy.daxRun).toHaveLength(3); // leu TABLES/MEASURES/COLUMNS
  expect(spy.embedded).toBe(1);
});

test('dataset já indexado → atalho: NÃO relê o schema nem reembeda', async () => {
  const { deps, spy } = makeDeps({ refs: ['abc123'] });
  const out = await ensureSchemaIndexed(deps, input);

  expect(out.data).toBe('ja-indexado');
  expect(spy.daxRun).toHaveLength(0); // zero chamadas REST — é o ponto do atalho
  expect(spy.embedded).toBe(0);
});

test('escopo: consulta o índice pelo repo do dataset pedido', async () => {
  const { deps, spy } = makeDeps({ refs: ['x'] });
  await ensureSchemaIndexed(deps, { workspaceId: 'ws', datasetId: 'ds-A' });
  expect(spy.refsPedidos).toEqual(['model:ds-A']);
});

test('datasets diferentes são acervos independentes', async () => {
  const { deps, spy } = makeDeps({ refs: [] });
  await ensureSchemaIndexed(deps, { workspaceId: 'ws', datasetId: 'ds-1' });
  await ensureSchemaIndexed(deps, { workspaceId: 'ws', datasetId: 'ds-2' });
  expect(spy.refsPedidos).toEqual(['model:ds-1', 'model:ds-2']);
});

test('índice indisponível propaga o status (não finge que indexou)', async () => {
  const { deps, spy } = makeDeps({ refsFail: true });
  const out = await ensureSchemaIndexed(deps, input);

  expect(out.status).toBe('unavailable');
  expect(spy.daxRun).toHaveLength(0);
});

test('falha ao ler o schema propaga — sem indexar pela metade', async () => {
  const { deps } = makeDeps({ refs: [] });
  deps.fabric.executeDax = async () => ({ status: 'failed', error: 'DatasetExecuteQueriesError' });
  const out = await ensureSchemaIndexed(deps, input);

  expect(out.status).not.toBe('ok');
  expect(out.error).toContain('falha lendo tables');
});
