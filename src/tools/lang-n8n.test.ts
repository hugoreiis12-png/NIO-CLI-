import { test, expect } from 'bun:test';
import {
  readDefinition,
  writeDefinition,
  handleLangN8n,
  handleLangN8nWrite,
  type N8nDeps,
} from './lang-n8n.js';

const ENV = { N8N_API_URL: 'https://n8n.example.com/', N8N_API_KEY: 'segredo-super-secreto' };

interface Chamada {
  url: string;
  method: string;
  key: string | null;
}

/** fetch fake que grava a chamada e devolve `body` com `status`. */
function fakeFetch(status: number, body: unknown, chamadas: Chamada[] = []): N8nDeps['fetch'] {
  return (async (url: string, init: RequestInit) => {
    chamadas.push({
      url,
      method: init.method ?? 'GET',
      key: new Headers(init.headers).get('X-N8N-API-KEY'),
    });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as unknown as N8nDeps['fetch'];
}

const textOf = (r: { content: Array<{ type: string; text?: string }> }): string =>
  r.content.map((c) => c.text ?? '').join('');

test('definições: nomes distintos e action obrigatória; só a de escrita exige id', () => {
  expect(readDefinition.name).toBe('nio_lang_n8n');
  expect(writeDefinition.name).toBe('nio_lang_n8n_write');
  expect(readDefinition.inputSchema.required).toEqual(['action']);
  expect(writeDefinition.inputSchema.required).toEqual(['action', 'id']);
});

test('sem N8N_API_URL/KEY: erro acionável, sem chamar a rede', async () => {
  const chamadas: Chamada[] = [];
  const r = await handleLangN8n(
    { action: 'list_workflows' },
    { env: {}, fetch: fakeFetch(200, {}, chamadas) },
  );
  expect(r.isError).toBe(true);
  expect(textOf(r)).toContain('N8N_API_URL e N8N_API_KEY');
  expect(chamadas).toHaveLength(0);
});

test('list_workflows: monta /api/v1 sem barra dupla, manda a chave e limita a página', async () => {
  const chamadas: Chamada[] = [];
  const r = await handleLangN8n(
    { action: 'list_workflows', active: true },
    { env: ENV, fetch: fakeFetch(200, { data: [{ id: '1' }], nextCursor: null }, chamadas) },
  );
  expect(r.isError).toBeUndefined();
  expect(chamadas[0]).toEqual({
    url: 'https://n8n.example.com/api/v1/workflows?limit=20&active=true',
    method: 'GET',
    key: 'segredo-super-secreto',
  });
});

test('N8N_API_URL já com /api/v1 não duplica o sufixo', async () => {
  const chamadas: Chamada[] = [];
  await handleLangN8n(
    { action: 'get_execution', id: 'e1' },
    {
      env: { ...ENV, N8N_API_URL: 'https://n8n.example.com/api/v1' },
      fetch: fakeFetch(200, {}, chamadas),
    },
  );
  expect(chamadas[0]!.url).toBe('https://n8n.example.com/api/v1/executions/e1');
});

test('URL insegura é recusada; http em loopback e LAN passa', async () => {
  const fetchSpy: Chamada[] = [];
  const f = fakeFetch(200, {}, fetchSpy);
  const remoto = await handleLangN8n(
    { action: 'list_workflows' },
    { env: { ...ENV, N8N_API_URL: 'http://n8n.example.com' }, fetch: f },
  );
  expect(remoto.isError).toBe(true);
  const local = await handleLangN8n(
    { action: 'list_workflows' },
    { env: { ...ENV, N8N_API_URL: 'http://localhost:5678' }, fetch: f },
  );
  expect(local.isError).toBeUndefined();
  // ACEITE: instância self-hosted num IP de LAN fala http sem exigir TLS.
  const lan = await handleLangN8n(
    { action: 'list_workflows' },
    { env: { ...ENV, N8N_API_URL: 'http://192.168.1.50:5678' }, fetch: f },
  );
  expect(lan.isError).toBeUndefined();
  expect(fetchSpy.at(-1)!.url).toStartWith('http://192.168.1.50:5678/api/v1/');
});

test('ids e parâmetros maliciosos não viram caminho nem query', async () => {
  const chamadas: Chamada[] = [];
  const deps = { env: ENV, fetch: fakeFetch(200, {}, chamadas) };
  expect(
    (await handleLangN8n({ action: 'get_workflow', id: '../credentials' }, deps)).isError,
  ).toBe(true);
  expect(
    (await handleLangN8n({ action: 'list_executions', workflowId: 'a&b=c' }, deps)).isError,
  ).toBe(true);
  expect((await handleLangN8n({ action: 'list_workflows', limit: 5000 }, deps)).isError).toBe(true);
  expect((await handleLangN8n({ action: 'list_workflows', cursor: 'x y' }, deps)).isError).toBe(
    true,
  );
  expect(chamadas).toHaveLength(0);
});

test('401/403: mensagem útil e NUNCA ecoa a chave', async () => {
  const r = await handleLangN8n(
    { action: 'list_workflows' },
    { env: ENV, fetch: fakeFetch(401, `unauthorized ${ENV.N8N_API_KEY}`) },
  );
  expect(r.isError).toBe(true);
  expect(textOf(r)).toContain('HTTP 401');
  expect(textOf(r)).not.toContain(ENV.N8N_API_KEY);
});

test('erro 500 trunca o corpo; falha de rede vira erro, não exceção', async () => {
  const longo = await handleLangN8n(
    { action: 'list_workflows' },
    { env: ENV, fetch: fakeFetch(500, 'x'.repeat(5000)) },
  );
  expect(textOf(longo).length).toBeLessThan(400);
  const quebrado = await handleLangN8n(
    { action: 'list_workflows' },
    {
      env: ENV,
      fetch: (async () => {
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof fetch,
    },
  );
  expect(quebrado.isError).toBe(true);
  expect(textOf(quebrado)).toContain('ECONNREFUSED');
});

test('write: activate/deactivate fazem POST no caminho certo', async () => {
  const chamadas: Chamada[] = [];
  const deps = { env: ENV, fetch: fakeFetch(200, { active: true }, chamadas) };
  await handleLangN8nWrite({ action: 'activate_workflow', id: 'wf1' }, deps);
  await handleLangN8nWrite({ action: 'deactivate_workflow', id: 'wf1' }, deps);
  expect(chamadas.map((c) => `${c.method} ${c.url}`)).toEqual([
    'POST https://n8n.example.com/api/v1/workflows/wf1/activate',
    'POST https://n8n.example.com/api/v1/workflows/wf1/deactivate',
  ]);
});

test('write: a tool de leitura NÃO aceita ações de escrita (e vice-versa)', async () => {
  const deps = { env: ENV, fetch: fakeFetch(200, {}) };
  expect((await handleLangN8n({ action: 'activate_workflow', id: 'x' }, deps)).isError).toBe(true);
  expect((await handleLangN8nWrite({ action: 'list_workflows', id: 'x' }, deps)).isError).toBe(
    true,
  );
  expect((await handleLangN8nWrite({ action: 'activate_workflow' }, deps)).isError).toBe(true);
});
