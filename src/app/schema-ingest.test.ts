/**
 * Contrato da ingestão de schema. O comportamento mais valioso é o **no-op quando o
 * schema não mudou**: embedding é a parte cara, e re-sincronizar não pode custar nada.
 */
import { test, expect } from 'bun:test';
import { ingestSchema, type SchemaIngestDeps } from './schema-ingest.js';
import type { FabricGateway, FabricRow } from '../core/fabric.js';
import type { DocChunk, DocIndex, EmbeddingProvider } from '../core/rag.js';

const TABLES: FabricRow[] = [
  { '[Name]': 'VISAO_COMERCIAL', '[IsHidden]': 'false' },
  { '[Name]': 'LocalDateTable_x', '[IsHidden]': 'true' },
];
const MEASURES: FabricRow[] = [
  { '[Name]': 'TOTAL_LIQUIDO', '[Table]': 'VISAO_COMERCIAL', '[IsHidden]': 'false' },
];
const COLUMNS: FabricRow[] = [
  { '[Name]': 'VALOR', '[Table]': 'VISAO_COMERCIAL', '[DataType]': 'Number', '[IsHidden]': 'false' },
];

interface Spy {
  embedded: string[][];
  indexed: DocChunk[][];
  daxRun: string[];
}

function makeDeps(opts: { knownRefs?: string[]; fabricFails?: boolean } = {}): {
  deps: SchemaIngestDeps;
  spy: Spy;
} {
  const spy: Spy = { embedded: [], indexed: [], daxRun: [] };

  const fabric: FabricGateway = {
    listWorkspaces: async () => ({ status: 'ok', data: [] }),
    listDatasets: async () => ({ status: 'ok', data: [] }),
    executeDax: async (_w, _d, dax) => {
      spy.daxRun.push(dax);
      if (opts.fabricFails) return { status: 'failed', error: 'DatasetExecuteQueriesError' };
      if (dax.includes('TABLES')) return { status: 'ok', data: TABLES };
      if (dax.includes('MEASURES')) return { status: 'ok', data: MEASURES };
      return { status: 'ok', data: COLUMNS };
    },
  };

  const embedder: EmbeddingProvider = {
    embedQuery: async () => ({ status: 'ok', data: [] }),
    embedPassages: async (texts) => {
      spy.embedded.push(texts);
      return { status: 'ok', data: texts.map(() => [0.1]) };
    },
  };

  const index: DocIndex = {
    indexChunks: async (chunks) => {
      spy.indexed.push(chunks);
      return { status: 'ok', data: chunks.length };
    },
    search: async () => ({ status: 'ok', data: [] }),
    indexedRefs: async () => ({ status: 'ok', data: opts.knownRefs ?? [] }),
  };

  return { deps: { fabric, embedder, index }, spy };
}

const input = { workspaceId: 'ws', datasetId: 'ds' };

test('usa INFO.VIEW.* (a forma sem VIEW dá 400 neste tenant)', async () => {
  const { deps, spy } = makeDeps();
  await ingestSchema(deps, input);
  expect(spy.daxRun).toEqual([
    'EVALUATE INFO.VIEW.TABLES()',
    'EVALUATE INFO.VIEW.MEASURES()',
    'EVALUATE INFO.VIEW.COLUMNS()',
  ]);
});

test('ingere: conta tabelas/medidas e grava os chunks', async () => {
  const { deps, spy } = makeDeps();
  const out = await ingestSchema(deps, input);

  expect(out.status).toBe('ok');
  expect(out.data!.tables).toBe(2); // total lido (o filtro de ocultas é do chunker)
  expect(out.data!.measures).toBe(1);
  expect(out.data!.unchanged).toBe(false);
  expect(out.data!.ref).not.toBe('');
  expect(spy.indexed[0]!.length).toBe(out.data!.chunks);
});

test('schema INALTERADO não reembeda nada (embedding é a parte cara)', async () => {
  // 1º passe: descobre o ref
  const primeiro = await ingestSchema(makeDeps().deps, input);
  const ref = primeiro.data!.ref;

  // 2º passe: o ref já está indexado
  const { deps, spy } = makeDeps({ knownRefs: [ref] });
  const out = await ingestSchema(deps, input);

  expect(out.data!.unchanged).toBe(true);
  expect(out.data!.inserted).toBe(0);
  expect(spy.embedded).toHaveLength(0); // não chamou o embedder
  expect(spy.indexed).toHaveLength(0); // não escreveu no banco
});

test('--force reingere mesmo com o ref conhecido', async () => {
  const primeiro = await ingestSchema(makeDeps().deps, input);
  const { deps, spy } = makeDeps({ knownRefs: [primeiro.data!.ref] });
  const out = await ingestSchema(deps, { ...input, force: true });

  expect(out.data!.unchanged).toBe(false);
  expect(spy.embedded).toHaveLength(1);
});

test('falha do Fabric aborta: meio schema é pior que nenhum', async () => {
  const { deps, spy } = makeDeps({ fabricFails: true });
  const out = await ingestSchema(deps, input);

  expect(out.status).not.toBe('ok');
  expect(out.error).toContain('falha lendo tables');
  expect(spy.embedded).toHaveLength(0);
  expect(spy.indexed).toHaveLength(0);
});

test('embedder indisponível propaga unconfigured, sem escrever', async () => {
  const { deps, spy } = makeDeps();
  deps.embedder = {
    embedQuery: async () => ({ status: 'unconfigured' }),
    embedPassages: async () => ({ status: 'unconfigured', error: 'rode nio fabric rag setup' }),
  };
  const out = await ingestSchema(deps, input);

  expect(out.status).toBe('unconfigured');
  expect(spy.indexed).toHaveLength(0);
});

test('o texto embedado carrega os nomes reais do modelo', async () => {
  const { deps, spy } = makeDeps();
  await ingestSchema(deps, input);
  const texto = spy.embedded[0]!.join('\n');

  expect(texto).toContain('VISAO_COMERCIAL');
  expect(texto).toContain('TOTAL_LIQUIDO');
  expect(texto).not.toContain('LocalDateTable'); // ruído da auto date/time fora
});
