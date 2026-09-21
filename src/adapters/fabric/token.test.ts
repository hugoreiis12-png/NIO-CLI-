import { test, expect } from 'bun:test';
import { createTokenProvider, readFabricAuthEnv } from './token.js';

const AUTH = { tenantId: 't', clientId: 'c', clientSecret: 's' };
const jsonRes = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('readFabricAuthEnv: lê os AZURE_* e faz trim', () => {
  const env = { AZURE_TENANT_ID: ' t ', AZURE_CLIENT_ID: 'c', AZURE_CLIENT_SECRET: 's' } as NodeJS.ProcessEnv;
  expect(readFabricAuthEnv(env)).toEqual({ tenantId: 't', clientId: 'c', clientSecret: 's' });
});

test('get: sem credenciais → unconfigured, sem tocar a rede', async () => {
  let called = false;
  const p = createTokenProvider({}, (async () => { called = true; return jsonRes({}); }) as unknown as typeof fetch);
  const out = await p.get();
  expect(out.status).toBe('unconfigured');
  expect(called).toBe(false);
});

test('get: 200 devolve o token e cacheia (2ª chamada não refaz o request)', async () => {
  let calls = 0;
  const fetchImpl = (async () => { calls++; return jsonRes({ access_token: 'abc', expires_in: 3600 }); }) as unknown as typeof fetch;
  const p = createTokenProvider(AUTH, fetchImpl);
  expect((await p.get())).toEqual({ status: 'ok', token: 'abc' });
  expect((await p.get()).token).toBe('abc');
  expect(calls).toBe(1); // cache
});

test('get: 401 → unauthorized', async () => {
  const p = createTokenProvider(AUTH, (async () => jsonRes({ error: 'invalid_client' }, 401)) as unknown as typeof fetch);
  expect((await p.get()).status).toBe('unauthorized');
});

test('get: exceção de rede → unavailable', async () => {
  const p = createTokenProvider(AUTH, (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch);
  const out = await p.get();
  expect(out.status).toBe('unavailable');
  expect(out.error).toContain('ECONNREFUSED');
});
