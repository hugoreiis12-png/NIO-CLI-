import { test, expect } from 'bun:test';
import { runFabricQuery, handler } from './fabric-query.js';
import type { FabricGateway, FabricResult, FabricRow } from '../core/fabric.js';
import type { ToolContext } from './index.js';

const ctx = {} as ToolContext;
const gwWith = (res: FabricResult<FabricRow[]>): FabricGateway =>
  ({
    executeDax: async () => res,
    listWorkspaces: async () => ({ status: 'ok', data: [] }),
    listDatasets: async () => ({ status: 'ok', data: [] }),
  }) as FabricGateway;

test('runFabricQuery: ok → jsonResult com row_count e rows', async () => {
  const rows = [{ 'T[A]': 1 }, { 'T[A]': 2 }];
  const out = await runFabricQuery(gwWith({ status: 'ok', data: rows }), 'ws', 'ds', 'EVALUATE T');
  expect(out.isError).toBeUndefined();
  expect(JSON.parse(out.content[0]!.text as string)).toEqual({ row_count: 2, rows });
});

test('runFabricQuery: failed → errorResult com a causa', async () => {
  const out = await runFabricQuery(gwWith({ status: 'failed', error: 'erro de sintaxe' }), 'ws', 'ds', 'EVALUATE ?');
  expect(out.isError).toBe(true);
  expect(out.content[0]!.text).toContain('erro de sintaxe');
});

test('runFabricQuery: unauthorized → errorResult explicando SP/RLS', async () => {
  const out = await runFabricQuery(gwWith({ status: 'unauthorized', error: '403' }), 'ws', 'ds', 'EVALUATE T');
  expect(out.isError).toBe(true);
  expect(out.content[0]!.text).toContain('Sem acesso ao Fabric');
});

test('handler: dax ausente → argumento inválido', async () => {
  const out = await handler({ workspace_id: 'ws', dataset_id: 'ds' }, ctx);
  expect(out.isError).toBe(true);
  expect(out.content[0]!.text).toContain('inválido');
});

test('handler: sem ids e sem env default → erro claro, sem tocar a rede', async () => {
  const savedW = process.env.NIO_FABRIC_WORKSPACE;
  const savedD = process.env.NIO_FABRIC_DATASET;
  delete process.env.NIO_FABRIC_WORKSPACE;
  delete process.env.NIO_FABRIC_DATASET;
  try {
    const out = await handler({ dax: 'EVALUATE T' }, ctx);
    expect(out.isError).toBe(true);
    expect(out.content[0]!.text).toContain('NIO_FABRIC_WORKSPACE');
  } finally {
    if (savedW === undefined) delete process.env.NIO_FABRIC_WORKSPACE; else process.env.NIO_FABRIC_WORKSPACE = savedW;
    if (savedD === undefined) delete process.env.NIO_FABRIC_DATASET; else process.env.NIO_FABRIC_DATASET = savedD;
  }
});
