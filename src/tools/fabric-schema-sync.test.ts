import { test, expect } from 'bun:test';
import { runSchemaSync } from './fabric-schema-sync.js';
import type { SchemaIngestDeps } from '../app/schema-ingest.js';
import type { FabricResult, FabricRow } from '../core/fabric.js';
import type { RagResult } from '../core/rag.js';

const TABELAS: FabricRow[] = [{ '[Name]': 'VISAO_COMERCIAL' }];
const MEDIDAS: FabricRow[] = [{ '[Name]': 'TOTAL', '[Table]': 'VISAO_COMERCIAL' }];
const COLUNAS: FabricRow[] = [
  { '[Table]': 'VISAO_COMERCIAL', '[Name]': 'data_lancamento', '[DataType]': 'Date' },
];

function schemaFor(dax: string): FabricRow[] {
  if (dax.includes('TABLES')) return TABELAS;
  if (dax.includes('MEASURES')) return MEDIDAS;
  return COLUNAS;
}

function makeDeps(over: Partial<SchemaIngestDeps> = {}, refsConhecidos: string[] = []) {
  const gravados: number[] = [];
  const deps: SchemaIngestDeps = {
    fabric: {
      executeDax: async (_w, _d, dax): Promise<FabricResult<FabricRow[]>> => ({
        status: 'ok',
        data: schemaFor(dax),
      }),
    } as unknown as SchemaIngestDeps['fabric'],
    embedder: {
      embedPassages: async (t: string[]): Promise<RagResult<number[][]>> => ({
        status: 'ok',
        data: t.map(() => [0.1]),
      }),
    } as unknown as SchemaIngestDeps['embedder'],
    index: {
      indexChunks: async (c: unknown[]) => {
        gravados.push(c.length);
        return { status: 'ok' as const, data: c.length };
      },
      indexedRefs: async () => ({ status: 'ok' as const, data: refsConhecidos }),
      search: async () => ({ status: 'ok' as const, data: [] }),
    } as unknown as SchemaIngestDeps['index'],
    ...over,
  };
  return { deps, gravados };
}

const texto = (r: { content: { type: string; text?: string }[] }) => r.content[0]?.text ?? '';

test('schema novo → relatório com contagens e ref', async () => {
  const { deps } = makeDeps();
  const res = await runSchemaSync(deps, 'ws', 'ds');

  expect(res.isError).toBeFalsy();
  const out = JSON.parse(texto(res));
  expect(out.estado).toBe('schema indexado');
  expect(out.tabelas).toBe(1);
  expect(out.medidas).toBe(1);
  expect(out.ref).toBeTruthy();
});

test('schema inalterado → não reembeda e diz isso', async () => {
  const primeiro = await runSchemaSync(makeDeps().deps, 'ws', 'ds');
  const ref = JSON.parse(texto(primeiro)).ref as string;

  const { deps, gravados } = makeDeps({}, [ref]);
  const res = await runSchemaSync(deps, 'ws', 'ds');

  expect(JSON.parse(texto(res)).estado).toBe('schema inalterado — nada reindexado');
  expect(gravados).toHaveLength(0); // o caro é o embedding: não pode rodar
});

test('force reindexa mesmo com o ref já conhecido', async () => {
  const primeiro = await runSchemaSync(makeDeps().deps, 'ws', 'ds');
  const ref = JSON.parse(texto(primeiro)).ref as string;

  const { deps, gravados } = makeDeps({}, [ref]);
  const res = await runSchemaSync(deps, 'ws', 'ds', true);

  expect(JSON.parse(texto(res)).estado).toBe('schema indexado');
  expect(gravados[0]).toBeGreaterThan(0);
});

test('Fabric fora do ar → erro rotulado, não exceção', async () => {
  const { deps } = makeDeps({
    fabric: {
      executeDax: async () => ({ status: 'unavailable', error: 'timeout' }),
    } as unknown as SchemaIngestDeps['fabric'],
  });
  const res = await runSchemaSync(deps, 'ws', 'ds');

  expect(res.isError).toBe(true);
  expect(texto(res)).toContain('Dependência indisponível');
  expect(texto(res)).toContain('timeout'); // o detalhe chega ao agente
});

test('embedder ausente → diz que a busca vetorial não está habilitada', async () => {
  const { deps } = makeDeps({
    embedder: {
      embedPassages: async () => ({ status: 'unconfigured', error: 'sem modelo local' }),
    } as unknown as SchemaIngestDeps['embedder'],
  });
  const res = await runSchemaSync(deps, 'ws', 'ds');

  expect(res.isError).toBe(true);
  expect(texto(res)).toContain('Busca vetorial não habilitada');
});