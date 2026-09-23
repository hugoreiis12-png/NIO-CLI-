import { test, expect } from 'bun:test';
import { createFabricGateway } from './client.js';
import type { TokenProvider } from './token.js';

const okToken: TokenProvider = { get: async () => ({ status: 'ok', token: 'tok' }) };
const jsonRes = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('executeDax: 200 extrai as linhas de results[0].tables[0].rows', async () => {
  const rows = [{ 'T[Ano]': 2010 }, { 'T[Ano]': 2011 }];
  const gw = createFabricGateway({
    token: okToken,
    fetchImpl: (async () => jsonRes({ results: [{ tables: [{ rows }] }] })) as unknown as typeof fetch,
  });
  const out = await gw.executeDax('ws', 'ds', 'EVALUATE T');
  expect(out.status).toBe('ok');
  expect(out.data).toEqual(rows);
});

test('executeDax: POST no endpoint certo com o corpo executeQueries', async () => {
  let seenUrl = '';
  let seenBody = '';
  const gw = createFabricGateway({
    token: okToken,
    fetchImpl: (async (url: string, init: RequestInit) => {
      seenUrl = url;
      seenBody = init.body as string;
      return jsonRes({ results: [{ tables: [{ rows: [] }] }] });
    }) as unknown as typeof fetch,
  });
  await gw.executeDax('WS 1', 'DS 1', 'EVALUATE VALUES(T)');
  expect(seenUrl).toBe('https://api.powerbi.com/v1.0/myorg/groups/WS%201/datasets/DS%201/executeQueries');
  expect(JSON.parse(seenBody)).toEqual({ queries: [{ query: 'EVALUATE VALUES(T)' }], serializerSettings: { includeNulls: true } });
});

test('executeDax: 400 (DAX ruim) → failed com a mensagem do erro', async () => {
  const gw = createFabricGateway({
    token: okToken,
    fetchImpl: (async () => jsonRes({ error: { code: 'DAX', message: 'Query (1, 1) erro de sintaxe' } }, 400)) as unknown as typeof fetch,
  });
  const out = await gw.executeDax('ws', 'ds', 'EVALUATE ???');
  expect(out.status).toBe('failed');
  expect(out.error).toContain('erro de sintaxe');
});

test('executeDax: 400 surfacea o pbi.error.details aninhado (o motivo REAL do DAX)', async () => {
  // O Power BI põe o diagnóstico acionável aqui; o message do topo é genérico.
  const body = {
    error: {
      code: 'DatasetExecuteQueriesError',
      message: 'An unexpected error occurred.',
      'pbi.error': {
        code: 'DatasetExecuteQueriesError',
        details: [{ detail: { value: "Cannot find table 'Metas'." } }],
      },
    },
  };
  const gw = createFabricGateway({
    token: okToken,
    fetchImpl: (async () => jsonRes(body, 400)) as unknown as typeof fetch,
  });
  const out = await gw.executeDax('ws', 'ds', "EVALUATE 'Metas'");
  expect(out.status).toBe('failed');
  expect(out.error).toContain("Cannot find table 'Metas'"); // o que importa
  expect(out.error).toContain('DatasetExecuteQueriesError'); // código como contexto
  expect(out.error).not.toContain('An unexpected error occurred'); // genérico não vence
});

test('executeDax: vários details aninhados são todos surfaceados', async () => {
  const body = {
    error: {
      'pbi.error': {
        details: [
          { detail: { value: 'The syntax for ")" is incorrect.' } },
          { detail: { value: "Column 'X' not found." } },
        ],
      },
    },
  };
  const gw = createFabricGateway({
    token: okToken,
    fetchImpl: (async () => jsonRes(body, 400)) as unknown as typeof fetch,
  });
  const out = await gw.executeDax('ws', 'ds', 'EVALUATE )');
  expect(out.error).toContain('syntax for ")" is incorrect');
  expect(out.error).toContain("Column 'X' not found");
});

test('executeDax: detail aninhado além de 500 chars no corpo ainda é extraído', async () => {
  // Regressão: o corpo era cortado em 500 chars ANTES do parse, matando o details.
  const body = {
    error: {
      code: 'DatasetExecuteQueriesError',
      message: 'x'.repeat(600), // empurra o details pra depois do antigo corte
      'pbi.error': { details: [{ detail: { value: "Cannot find table 'Vendas'." } }] },
    },
  };
  const gw = createFabricGateway({
    token: okToken,
    fetchImpl: (async () => jsonRes(body, 400)) as unknown as typeof fetch,
  });
  const out = await gw.executeDax('ws', 'ds', "EVALUATE 'Vendas'");
  expect(out.error).toContain("Cannot find table 'Vendas'");
});

test('executeDax: erro embutido com HTTP 200 também usa o details aninhado', async () => {
  const body = {
    results: [
      { error: { 'pbi.error': { details: [{ detail: { value: 'Resultset too large.' } }] } } },
    ],
  };
  const gw = createFabricGateway({
    token: okToken,
    fetchImpl: (async () => jsonRes(body)) as unknown as typeof fetch,
  });
  const out = await gw.executeDax('ws', 'ds', "EVALUATE 'Big'");
  expect(out.status).toBe('failed');
  expect(out.error).toContain('Resultset too large');
});

test('executeDax: erro embutido com HTTP 200 (mais de uma tabela) → failed', async () => {
  const gw = createFabricGateway({
    token: okToken,
    fetchImpl: (async () => jsonRes({ results: [{ error: { message: 'More than one result table in a query' } }] })) as unknown as typeof fetch,
  });
  const out = await gw.executeDax('ws', 'ds', 'EVALUATE T EVALUATE U');
  expect(out.status).toBe('failed');
  expect(out.error).toContain('More than one result table');
});

test('executeDax: 403 → unauthorized', async () => {
  const gw = createFabricGateway({
    token: okToken,
    fetchImpl: (async () => jsonRes({ error: { message: 'forbidden' } }, 403)) as unknown as typeof fetch,
  });
  expect((await gw.executeDax('ws', 'ds', 'EVALUATE T')).status).toBe('unauthorized');
});

test('executeDax: token não configurado → failed, sem tocar a rede', async () => {
  let called = false;
  const gw = createFabricGateway({
    token: { get: async () => ({ status: 'unconfigured', error: 'sem AZURE_*' }) },
    fetchImpl: (async () => { called = true; return jsonRes({}); }) as unknown as typeof fetch,
  });
  const out = await gw.executeDax('ws', 'ds', 'EVALUATE T');
  expect(out.status).toBe('failed');
  expect(called).toBe(false);
});

test('listWorkspaces: pagina o @odata.nextLink e concatena', async () => {
  let call = 0;
  const gw = createFabricGateway({
    token: okToken,
    fetchImpl: (async () => {
      call++;
      return call === 1
        ? jsonRes({ value: [{ id: '1', name: 'A' }], '@odata.nextLink': 'https://api.powerbi.com/next' })
        : jsonRes({ value: [{ id: '2', name: 'B' }] });
    }) as unknown as typeof fetch,
  });
  const out = await gw.listWorkspaces();
  expect(out.status).toBe('ok');
  expect(out.data).toEqual([{ id: '1', name: 'A' }, { id: '2', name: 'B' }]);
  expect(call).toBe(2);
});
