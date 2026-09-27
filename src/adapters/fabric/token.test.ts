import { test, expect } from 'bun:test';
import {
  createTokenProvider, readFabricAuthEnv, fabricGrant, describeAadFailure, retryAfterSeconds, sharedTokenProvider,
} from './token.js';

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

test('get (ROPC): MFA/Conditional Access (AADSTS50076) → unauthorized com dica de usar SP', async () => {
  const body = { error: 'invalid_grant', error_description: 'AADSTS50076: Due to a configuration change made by the admin, the user must use multi-factor authentication.' };
  const out = await createTokenProvider(USER, (async () => jsonRes(body, 400)) as unknown as typeof fetch).get();
  expect(out.status).toBe('unauthorized');
  expect(out.error).toContain('AADSTS50076');
  expect(out.error).toContain('MFA');
  expect(out.error).toContain('service principal');
});

test('get (SP): secret expirado (AADSTS7000222) → diz EXPIRADO, não "senha errada"', async () => {
  const body = { error: 'invalid_client', error_description: 'AADSTS7000222: The provided client secret keys for app are expired.' };
  const out = await createTokenProvider(SP, (async () => jsonRes(body, 401)) as unknown as typeof fetch).get();
  expect(out.status).toBe('unauthorized');
  expect(out.error).toContain('EXPIRADO');
  expect(out.error).toContain('AZURE_CLIENT_SECRET');
});

test('get: 429 no /token → unavailable com o Retry-After em segundos', async () => {
  const res = new Response('{}', { status: 429, headers: { 'Retry-After': '17' } });
  const out = await createTokenProvider(SP, (async () => res) as unknown as typeof fetch).get();
  expect(out.status).toBe('unavailable');
  expect(out.error).toContain('aguarde 17s');
});

test('describeAadFailure: corpo não-JSON não quebra e o AADSTS ainda é achado', () => {
  expect(describeAadFailure(400, '<html>AADSTS50126 bla</html>')).toContain('AADSTS50126');
  expect(describeAadFailure(502, 'Bad Gateway')).toBe('token endpoint respondeu 502 Bad Gateway');
});

test('retryAfterSeconds: número, data HTTP e ausente', () => {
  expect(retryAfterSeconds(new Response('', { headers: { 'Retry-After': '30' } }))).toBe(30);
  const future = new Date(Date.now() + 65_000).toUTCString();
  const fromDate = retryAfterSeconds(new Response('', { headers: { 'Retry-After': future } }));
  expect(fromDate).toBeGreaterThanOrEqual(60);
  expect(fromDate).toBeLessThanOrEqual(66);
  expect(retryAfterSeconds(new Response(''))).toBeNull();
});

test('invalidate: descarta o cache e o próximo get vai à rede', async () => {
  let calls = 0;
  const p = createTokenProvider(SP, (async () => { calls++; return jsonRes({ access_token: `t${calls}`, expires_in: 3600 }); }) as unknown as typeof fetch);
  expect((await p.get()).token).toBe('t1');
  p.invalidate?.();
  expect((await p.get()).token).toBe('t2');
  expect(calls).toBe(2);
});

test('sharedTokenProvider: mesma credencial → mesma instância; credencial diferente → outra', () => {
  const a = sharedTokenProvider(SP);
  expect(sharedTokenProvider({ ...SP })).toBe(a);
  expect(sharedTokenProvider({ ...SP, clientSecret: 'rotacionado' })).not.toBe(a);
  expect(sharedTokenProvider(USER)).not.toBe(a);
});
