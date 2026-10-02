import { test, expect } from 'bun:test';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { detectNativeTools, normalizeNativeUrl, type N8nNativeDeps } from './native-client.js';

const URL_BASE = 'https://n8n.example.com';
const TOKEN = 'token-super-secreto';

interface Chamada {
  method: string;
  auth: string | null;
}

interface FakeOpts {
  /** Páginas de tools; mais de uma exercita o `nextCursor`. */
  pages?: string[][];
  /** Status de erro na chamada de `tools/list`. */
  listStatus?: number;
  serverInfo?: { name: string; version: string };
}

/**
 * fetch que fala o mínimo de streamable HTTP: `initialize` → 200 JSON,
 * `notifications/*` → 202, `tools/list` → 200 JSON, GET → 405 (sem stream SSE).
 */
function fakeMcp(opts: FakeOpts = {}, chamadas: Chamada[] = []): N8nNativeDeps['fetch'] {
  const pages = opts.pages ?? [['search_workflows', 'execute_workflow']];
  return (async (_url: string | URL, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    chamadas.push({ method, auth: new Headers(init.headers).get('Authorization') });
    if (method === 'GET') return new Response(null, { status: 405 });

    const body = JSON.parse(String(init.body)) as { id?: number; method?: string };
    if (body.method?.startsWith('notifications/')) return new Response(null, { status: 202 });

    const json = (result: unknown) =>
      new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });

    if (body.method === 'initialize') {
      return json({
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: opts.serverInfo ?? { name: 'n8n', version: '2.36.0' },
      });
    }
    if (body.method === 'tools/list') {
      if (opts.listStatus) {
        return new Response('nope', { status: opts.listStatus });
      }
      const index = chamadas.filter((c) => c.method === 'POST').length;
      const page = pages[Math.min(index - 3, pages.length - 1)] ?? [];
      const last = page === pages[pages.length - 1];
      return json({
        tools: page.map((name) => ({ name, inputSchema: { type: 'object' } })),
        ...(last ? {} : { nextCursor: 'proxima' }),
      });
    }
    return json({});
  }) as unknown as N8nNativeDeps['fetch'];
}

test('normalizeNativeUrl: aceita com e sem o sufixo, idempotente, sem barra dupla', () => {
  expect(normalizeNativeUrl(URL_BASE)).toBe(`${URL_BASE}/mcp-server/http`);
  expect(normalizeNativeUrl(`${URL_BASE}/`)).toBe(`${URL_BASE}/mcp-server/http`);
  expect(normalizeNativeUrl(`${URL_BASE}/mcp-server/http`)).toBe(`${URL_BASE}/mcp-server/http`);
});

test('normalizeNativeUrl: recusa http fora de loopback, aceita localhost, recusa lixo', () => {
  expect(normalizeNativeUrl('http://n8n.example.com')).toEqual({
    error: 'a URL precisa ser https (http só em localhost).',
  });
  expect(normalizeNativeUrl('http://localhost:5678')).toBe('http://localhost:5678/mcp-server/http');
  expect(normalizeNativeUrl('nao-e-url')).toHaveProperty('error');
  expect(normalizeNativeUrl('   ')).toEqual({ error: 'URL vazia.' });
});

test('detecção bem-sucedida: devolve tools, versão do servidor e manda o Bearer', async () => {
  const chamadas: Chamada[] = [];
  const res = await detectNativeTools(URL_BASE, TOKEN, { fetch: fakeMcp({}, chamadas) });
  expect(res.ok).toBe(true);
  expect(res.tools).toEqual(['search_workflows', 'execute_workflow']);
  expect(res.serverVersion).toBe('n8n 2.36.0');
  expect(chamadas.some((c) => c.auth === `Bearer ${TOKEN}`)).toBe(true);
});

test('pagina o tools/list até acabar o nextCursor', async () => {
  const res = await detectNativeTools(URL_BASE, TOKEN, {
    fetch: fakeMcp({ pages: [['search_workflows'], ['execute_workflow', 'test_workflow']] }),
  });
  expect(res.ok).toBe(true);
  expect(res.tools).toEqual(['search_workflows', 'execute_workflow', 'test_workflow']);
});

test('tools vazio é falha, não "nada a liberar" — senão o falha-fechado se inverte', async () => {
  const res = await detectNativeTools(URL_BASE, TOKEN, { fetch: fakeMcp({ pages: [[]] }) });
  expect(res.ok).toBe(false);
  expect(res.error).toContain('nenhuma tool');
  expect(res.tools).toBeUndefined();
});

test('401 vira erro acionável e NUNCA ecoa o token', async () => {
  const res = await detectNativeTools(URL_BASE, TOKEN, { fetch: fakeMcp({ listStatus: 401 }) });
  expect(res.ok).toBe(false);
  expect(res.error).toContain('401');
  expect(res.error).not.toContain(TOKEN);
});

test('404 sugere MCP desabilitado na instância, sem vazar token', async () => {
  const res = await detectNativeTools(URL_BASE, TOKEN, { fetch: fakeMcp({ listStatus: 404 }) });
  expect(res.ok).toBe(false);
  expect(res.error).toContain('Settings');
  expect(res.error).not.toContain(TOKEN);
});

test('URL ruim e token vazio falham sem tocar a rede', async () => {
  const chamadas: Chamada[] = [];
  const fetchSpy = fakeMcp({}, chamadas);
  expect((await detectNativeTools('http://n8n.example.com', TOKEN, { fetch: fetchSpy })).ok).toBe(
    false,
  );
  expect((await detectNativeTools(URL_BASE, '  ', { fetch: fetchSpy })).ok).toBe(false);
  expect(chamadas).toHaveLength(0);
});

test('erro de rede não vaza o token na mensagem', async () => {
  const explode = (async () => {
    throw new Error(`conexão recusada em ${URL_BASE} com Bearer ${TOKEN}`);
  }) as unknown as N8nNativeDeps['fetch'];
  const res = await detectNativeTools(URL_BASE, TOKEN, { fetch: explode });
  expect(res.ok).toBe(false);
  expect(res.error).not.toContain(TOKEN);
});
