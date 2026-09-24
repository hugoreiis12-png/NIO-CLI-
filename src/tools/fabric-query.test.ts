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

test('ACEITE: tabela inventada é barrada ANTES de gastar request no Fabric', () => {
  // O 400 do Fabric (`Cannot find table`) não diz o que existe, então o modelo chuta
  // de novo e queima as 120 req/min. Aqui a recusa é local e traz os nomes reais.
  let bateu = false;
  const gw = { executeDax: async () => { bateu = true; return { status: 'ok' as const, data: [] }; } };
  return runFabricQuery(
    gw as never, 'ws', 'ds', "EVALUATE 'Metas'",
    async () => ['VISAO_COMERCIAL', 'CALENDARIO'],
  ).then((res) => {
    expect(bateu).toBe(false); // não chegou a chamar a API
    expect(res.isError).toBe(true);
    expect(String(res.content[0]?.text)).toContain('VISAO_COMERCIAL'); // mostra o que existe
  });
});

test('tabela real passa e executa normalmente', async () => {
  let bateu = false;
  const gw = { executeDax: async () => { bateu = true; return { status: 'ok' as const, data: [{ a: 1 }] }; } };
  const res = await runFabricQuery(
    gw as never, 'ws', 'ds', "EVALUATE 'VISAO_COMERCIAL'",
    async () => ['VISAO_COMERCIAL'],
  );
  expect(bateu).toBe(true);
  expect(res.isError).toBeFalsy();
});

test('sem acervo indexado não bloqueia — executa e deixa o Fabric decidir', async () => {
  let bateu = false;
  const gw = { executeDax: async () => { bateu = true; return { status: 'ok' as const, data: [] }; } };
  await runFabricQuery(gw as never, 'ws', 'ds', "EVALUATE 'QualquerCoisa'", async () => []);
  expect(bateu).toBe(true);
});

test('sem loader de inventário o comportamento antigo se mantém', async () => {
  let bateu = false;
  const gw = { executeDax: async () => { bateu = true; return { status: 'ok' as const, data: [] }; } };
  await runFabricQuery(gw as never, 'ws', 'ds', "EVALUATE 'Metas'");
  expect(bateu).toBe(true);
});
