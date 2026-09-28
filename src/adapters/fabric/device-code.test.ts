import { test, expect } from 'bun:test';
import { startDeviceAuth, pollDeviceToken, refreshAccessToken, type DeviceCodeStart } from './device-code.js';

const AUTH = { tenantId: 't', clientId: 'c' };
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const asFetch = (fn: (url: string, init: RequestInit) => Promise<Response>): typeof fetch =>
  fn as unknown as typeof fetch;

/** Poll sem espera real: intervalo 0 e o passo de `slow_down` zerado. */
const START: DeviceCodeStart = {
  deviceCode: 'dev-123',
  userCode: 'ABCD-EFGH',
  verificationUri: 'https://login.microsoft.com/device',
  expiresInSec: 2,
  intervalSec: 0,
};
const semEspera = (fetchImpl: typeof fetch) => ({ slowDownStepMs: 0, fetchImpl });

test('startDeviceAuth: devolve o código que a pessoa digita', async () => {
  const r = await startDeviceAuth(AUTH, asFetch(async () =>
    json({ device_code: 'dev-123', user_code: 'ABCD-EFGH', verification_uri: 'https://x/device', expires_in: 900, interval: 5 })));
  expect(r.status).toBe('ok');
  if (r.status !== 'ok') return;
  expect(r.data.userCode).toBe('ABCD-EFGH');
  expect(r.data.verificationUri).toBe('https://x/device');
  expect(r.data.intervalSec).toBe(5);
});

test('startDeviceAuth: nunca manda client_secret (é cliente público)', async () => {
  let enviado = '';
  await startDeviceAuth({ ...AUTH, clientSecret: 'nao-deve-ir' }, asFetch(async (_u, init) => {
    enviado = String(init.body);
    return json({ device_code: 'd', user_code: 'u' });
  }));
  expect(enviado).not.toContain('nao-deve-ir');
  expect(enviado).not.toContain('client_secret');
  expect(enviado).toContain('offline_access'); // sem isso não vem refresh_token
});

test('startDeviceAuth: erro do Entra vira failed com o motivo', async () => {
  const r = await startDeviceAuth(AUTH, asFetch(async () =>
    json({ error: 'unauthorized_client', error_description: 'AADSTS7000218: public client flows desabilitado' }, 400)));
  expect(r.status).toBe('failed');
  if (r.status === 'failed') expect(r.error).toContain('AADSTS7000218');
});

test('pollDeviceToken: authorization_pending continua até aprovar', async () => {
  let n = 0;
  const r = await pollDeviceToken(AUTH, START, semEspera(asFetch(async () => {
    n++;
    return n < 3
      ? json({ error: 'authorization_pending' }, 400)
      : json({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 });
  })));
  expect(r.status).toBe('ok');
  if (r.status === 'ok') expect(r.data.refreshToken).toBe('rt');
  expect(n).toBe(3);
});

test('pollDeviceToken: slow_down não aborta, só espaça', async () => {
  let n = 0;
  const r = await pollDeviceToken(AUTH, START, semEspera(asFetch(async () => {
    n++;
    return n === 1 ? json({ error: 'slow_down' }, 400) : json({ access_token: 'at', refresh_token: 'rt' });
  })));
  expect(r.status).toBe('ok');
  expect(n).toBe(2);
});

test('pollDeviceToken: recusa no navegador para na hora', async () => {
  const r = await pollDeviceToken(AUTH, START, semEspera(asFetch(async () =>
    json({ error: 'authorization_declined' }, 400))));
  expect(r.status).toBe('failed');
  if (r.status === 'failed') expect(r.error).toContain('negado');
});

test('pollDeviceToken: código expirado manda rodar o login de novo', async () => {
  const r = await pollDeviceToken(AUTH, START, semEspera(asFetch(async () =>
    json({ error: 'expired_token' }, 400))));
  expect(r.status).toBe('failed');
  if (r.status === 'failed') expect(r.error).toContain('nio fabric login');
});

test('sem refresh_token a resposta é recusada — senão o login morre na 1ª renovação', async () => {
  const r = await pollDeviceToken(AUTH, START, semEspera(asFetch(async () =>
    json({ access_token: 'at', expires_in: 3600 }))));
  expect(r.status).toBe('failed');
  if (r.status === 'failed') expect(r.error).toContain('offline_access');
});

test('refreshAccessToken: troca o refresh por um access novo', async () => {
  const r = await refreshAccessToken(AUTH, 'rt-antigo', asFetch(async () =>
    json({ access_token: 'at-novo', refresh_token: 'rt-rotacionado', expires_in: 3600 })));
  expect(r.status).toBe('ok');
  if (r.status === 'ok') {
    expect(r.data.accessToken).toBe('at-novo');
    expect(r.data.refreshToken).toBe('rt-rotacionado');
  }
});

test('refreshAccessToken: refresh revogado vira failed', async () => {
  const r = await refreshAccessToken(AUTH, 'rt-morto', asFetch(async () =>
    json({ error: 'invalid_grant', error_description: 'AADSTS700082: refresh token expirado' }, 400)));
  expect(r.status).toBe('failed');
  if (r.status === 'failed') expect(r.error).toContain('AADSTS700082');
});
