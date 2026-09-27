import { test, expect } from 'bun:test';
import { createFabricScanner } from './scanner.js';
import type { TokenProvider } from './token.js';

const okToken: TokenProvider = { get: async () => ({ status: 'ok', token: 'tok' }) };
const jsonRes = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('scanDataset: toda chamada HTTP leva timeout (AbortSignal) — nada fica pendurado', async () => {
  const signals: unknown[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    signals.push(init.signal);
    if (url.includes('getInfo')) return jsonRes({ id: 'job1', status: 'Succeeded' });
    return jsonRes({ workspaces: [{ datasets: [{ id: 'ds', name: 'D', tables: [{ name: 'T' }] }] }] });
  }) as unknown as typeof fetch;
  const out = await createFabricScanner(okToken, fetchImpl).scanDataset('ws', 'ds');
  expect(out.status).toBe('ok');
  expect(signals.length).toBe(2);
  for (const s of signals) expect(s).toBeInstanceOf(AbortSignal);
});

test('scanDataset: 429 no getInfo → throttled com Retry-After', async () => {
  const fetchImpl = (async () => new Response('', { status: 429, headers: { 'Retry-After': '9' } })) as unknown as typeof fetch;
  const out = await createFabricScanner(okToken, fetchImpl).scanDataset('ws', 'ds');
  expect(out.status).toBe('throttled');
  expect(out.error).toContain('aguarde 9s');
});

test('scanDataset: 401 no getInfo → unauthorized citando o tenant setting da API admin', async () => {
  const fetchImpl = (async () => jsonRes({}, 401)) as unknown as typeof fetch;
  const out = await createFabricScanner(okToken, fetchImpl).scanDataset('ws', 'ds');
  expect(out.status).toBe('unauthorized');
  expect(out.error).toContain('read-only admin APIs');
});

test('scanDataset: DisabledByAdmin no dataRetrievalState → disabled', async () => {
  const fetchImpl = (async (url: string) => {
    if (url.includes('getInfo')) return jsonRes({ id: 'job1', status: 'Succeeded' });
    return jsonRes({ workspaces: [{ dataRetrievalState: 'DatasetSchemaDisabledByAdmin', datasets: [] }] });
  }) as unknown as typeof fetch;
  const out = await createFabricScanner(okToken, fetchImpl).scanDataset('ws', 'ds');
  expect(out.status).toBe('disabled');
});
