import { afterEach, describe, expect, test } from 'bun:test';
import {
  createHttpSmsSender,
  parseAuthHeader,
  renderBody,
  smsMode,
  smsProviderHost,
} from './http-generic.js';

describe('smsMode / smsProviderHost', () => {
  const T = '{"to":"{to}","text":"{text}"}';
  test('sem url/template → unconfigured', () => {
    expect(smsMode({})).toBe('unconfigured');
    expect(smsMode({ url: 'https://api.x/sms' })).toBe('unconfigured'); // falta template
    expect(smsProviderHost({})).toBeNull();
  });
  test('loopback → echo', () => {
    expect(smsMode({ url: 'http://127.0.0.1:4545/send', bodyTemplate: T })).toBe('echo');
    expect(smsMode({ url: 'http://localhost:4545/send', bodyTemplate: T })).toBe('echo');
  });
  test('host externo → provider + host', () => {
    expect(smsMode({ url: 'https://api.provedor.com/v2/sms', bodyTemplate: T })).toBe('provider');
    expect(smsProviderHost({ url: 'https://api.provedor.com/v2/sms' })).toBe('api.provedor.com');
  });
  test('url malformada → provider (o send() reporta a falha)', () => {
    expect(smsMode({ url: 'nao-e-url', bodyTemplate: T })).toBe('provider');
  });
});

describe('parseAuthHeader', () => {
  test('"Nome: valor" → objeto', () => {
    expect(parseAuthHeader('X-API-TOKEN: abc123')).toEqual({ 'X-API-TOKEN': 'abc123' });
    expect(parseAuthHeader('Authorization: Bearer x y')).toEqual({ Authorization: 'Bearer x y' });
  });
  test('malformado / ausente → {}', () => {
    expect(parseAuthHeader(undefined)).toEqual({});
    expect(parseAuthHeader('sem-dois-pontos')).toEqual({});
    expect(parseAuthHeader(': valor')).toEqual({});
  });
});

describe('renderBody', () => {
  test('substitui {to}/{text}/{from} com escape JSON', () => {
    const out = renderBody('{"to":"{to}","message":"{text}","from":"{from}"}', {
      to: '+5511999999999',
      text: 'código "481920"',
      from: 'NIO',
    });
    expect(JSON.parse(out)).toEqual({
      to: '+5511999999999',
      message: 'código "481920"',
      from: 'NIO',
    });
  });
});

describe('createHttpSmsSender', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test('sem env → skipped, não faz fetch', async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response('', { status: 200 });
    }) as typeof fetch;
    const r = await createHttpSmsSender({}).send('+55', 'oi');
    expect(r.status).toBe('skipped');
    expect(called).toBe(false);
  });

  test('2xx → sent, com header de auth e corpo do template', async () => {
    let seen: { url: string; headers: Headers; body: string } | null = null;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      seen = { url, headers: new Headers(init.headers), body: String(init.body) };
      return new Response('ok', { status: 202 });
    }) as unknown as typeof fetch;

    const r = await createHttpSmsSender({
      url: 'https://api.x/sms',
      authHeader: 'X-API-TOKEN: tok',
      bodyTemplate: '{"phone":"{to}","msg":"{text}"}',
    }).send('+5511988887777', 'NIO: 481920');

    expect(r.status).toBe('sent');
    expect(seen!.url).toBe('https://api.x/sms');
    expect(seen!.headers.get('X-API-TOKEN')).toBe('tok');
    expect(JSON.parse(seen!.body)).toEqual({ phone: '+5511988887777', msg: 'NIO: 481920' });
  });

  test('não-2xx → failed com o status', async () => {
    globalThis.fetch = (async () => new Response('quota', { status: 429 })) as typeof fetch;
    const r = await createHttpSmsSender({
      url: 'https://api.x/sms',
      bodyTemplate: '{"to":"{to}","text":"{text}"}',
    }).send('+55', 'oi');
    expect(r.status).toBe('failed');
    expect(r.error).toContain('429');
  });

  test('fetch lança → failed, não propaga', async () => {
    globalThis.fetch = (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    const r = await createHttpSmsSender({
      url: 'https://api.x/sms',
      bodyTemplate: '{}',
    }).send('+55', 'oi');
    expect(r.status).toBe('failed');
    expect(r.error).toContain('ECONNREFUSED');
  });
});
