import { test, expect } from 'bun:test';
import { createTokenProvider, readFabricAuthEnv, fabricGrant } from './token.js';

const SP = { tenantId: 't', clientId: 'c', clientSecret: 's' };
const USER = { tenantId: 't', clientId: 'c', clientSecret: 's', username: 'u@x.com', password: 'pw' };
const jsonRes = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('readFabricAuthEnv: lê AZURE_* + NIO_FABRIC_USERNAME/PASSWORD', () => {
  const env = {
    AZURE_TENANT_ID: ' t ', AZURE_CLIENT_ID: 'c', AZURE_CLIENT_SECRET: 's',
    NIO_FABRIC_USERNAME: ' u@x.com ', NIO_FABRIC_PASSWORD: 'pw',
  } as NodeJS.ProcessEnv;
  expect(readFabricAuthEnv(env)).toEqual({ tenantId: 't', clientId: 'c', clientSecret: 's', username: 'u@x.com', password: 'pw' });
});

test('fabricGrant: usuário vence SP; SP quando só há secret; null sem credencial', () => {
  expect(fabricGrant(USER)).toBe('user');
  expect(fabricGrant(SP)).toBe('service_principal');
  expect(fabricGrant({ tenantId: 't', clientId: 'c' })).toBeNull();
  expect(fabricGrant({})).toBeNull();
});

test('get: sem credencial → unconfigured, sem tocar a rede', async () => {
  let called = false;
  const p = createTokenProvider({}, (async () => { called = true; return jsonRes({}); }) as unknown as typeof fetch);
  expect((await p.get()).status).toBe('unconfigured');
  expect(called).toBe(false);
});

test('get (SP): client_credentials, 200 devolve token e cacheia', async () => {
  let calls = 0;
  let grantType = '';
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    calls++;
    grantType = (init.body as URLSearchParams).get('grant_type') ?? '';
    return jsonRes({ access_token: 'abc', expires_in: 3600 });
  }) as unknown as typeof fetch;
  const p = createTokenProvider(SP, fetchImpl);
  const out = await p.get();
  expect(out).toEqual({ status: 'ok', token: 'abc', grant: 'service_principal' });
  expect(grantType).toBe('client_credentials');
  await p.get();
  expect(calls).toBe(1); // cache
});

test('get (usuário/ROPC): grant password com username, respeita RLS', async () => {
  let body: URLSearchParams | undefined;
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    body = init.body as URLSearchParams;
    return jsonRes({ access_token: 'user-tok', expires_in: 3600 });
  }) as unknown as typeof fetch;
  const out = await createTokenProvider(USER, fetchImpl).get();
  expect(out).toEqual({ status: 'ok', token: 'user-tok', grant: 'user' });
  expect(body?.get('grant_type')).toBe('password');
  expect(body?.get('username')).toBe('u@x.com');
  expect(body?.get('client_secret')).toBe('s'); // app confidencial
});

test('get: 401 → unauthorized', async () => {
  const p = createTokenProvider(SP, (async () => jsonRes({ error: 'invalid_client' }, 401)) as unknown as typeof fetch);
  expect((await p.get()).status).toBe('unauthorized');
});

test('get: exceção de rede → unavailable', async () => {
  const p = createTokenProvider(SP, (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch);
  const out = await p.get();
  expect(out.status).toBe('unavailable');
  expect(out.error).toContain('ECONNREFUSED');
});
