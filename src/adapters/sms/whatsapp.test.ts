import { afterEach, describe, expect, test } from 'bun:test';
import {
  buildPayload,
  createWhatsAppSender,
  formatWhatsAppNumber,
  smsMode,
  smsProviderHost,
} from './whatsapp.js';

describe('formatWhatsAppNumber / buildPayload', () => {
  test('remove o `+` de prefixo E.164', () => {
    expect(formatWhatsAppNumber('+5511988887777')).toBe('5511988887777');
    expect(formatWhatsAppNumber('5511988887777')).toBe('5511988887777');
  });
  test('monta o payload do template com código no body e no botão', () => {
    const out = JSON.parse(buildPayload('+5511988887777', '481920'));
    expect(out).toEqual({
      messaging_product: 'whatsapp',
      to: '5511988887777',
      type: 'template',
      template: {
        name: 'autenticao',
        language: { code: 'pt_BR' },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: '481920' }] },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: '481920' }],
          },
        ],
      },
    });
  });
  test('respeita template name/language customizados', () => {
    const out = JSON.parse(
      buildPayload('+5511988887777', '123456', {
        templateName: 'login_otp',
        templateLanguage: 'en',
      }),
    );
    expect(out.template.name).toBe('login_otp');
    expect(out.template.language.code).toBe('en');
  });
});

describe('smsMode / smsProviderHost', () => {
  const TOKEN = 'tok';
  test('sem url/token → unconfigured', () => {
    expect(smsMode({})).toBe('unconfigured');
    expect(smsMode({ url: 'https://graph.meta.com/send' })).toBe('unconfigured'); // falta token
    expect(smsProviderHost({})).toBeNull();
  });
  test('loopback → echo', () => {
    expect(smsMode({ url: 'http://127.0.0.1:4545/send', token: TOKEN })).toBe('echo');
    expect(smsMode({ url: 'http://localhost:4545/send', token: TOKEN })).toBe('echo');
  });
  test('host externo → provider + host', () => {
    expect(smsMode({ url: 'https://graph.facebook.com/v25.0/x/messages', token: TOKEN })).toBe('provider');
    expect(smsProviderHost({ url: 'https://graph.facebook.com/v25.0/x/messages' })).toBe(
      'graph.facebook.com',
    );
  });
  test('url malformada → provider (o sendOtp() reporta a falha)', () => {
    expect(smsMode({ url: 'nao-e-url', token: TOKEN })).toBe('provider');
  });
});

describe('createWhatsAppSender', () => {
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
    const r = await createWhatsAppSender({}).sendOtp('+55', '123456');
    expect(r.status).toBe('skipped');
    expect(called).toBe(false);
  });

  test('2xx → sent, com Bearer token e corpo do template', async () => {
    let seen: { url: string; headers: Headers; body: string } | null = null;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      seen = { url, headers: new Headers(init.headers), body: String(init.body) };
      return new Response('received', { status: 200 });
    }) as unknown as typeof fetch;

    const r = await createWhatsAppSender({
      url: 'https://graph.facebook.com/v25.0/1076830002188066/messages',
      token: 'tok-secreto',
    }).sendOtp('+5511988887777', '481920');

    expect(r.status).toBe('sent');
    expect(seen!.url).toBe('https://graph.facebook.com/v25.0/1076830002188066/messages');
    expect(seen!.headers.get('Authorization')).toBe('Bearer tok-secreto');
    expect(seen!.headers.get('Content-Type')).toBe('application/json');
    const body = JSON.parse(seen!.body);
    expect(body.to).toBe('5511988887777');
    expect(body.template.components[0].parameters[0].text).toBe('481920');
  });

  test('não-2xx → failed com o status', async () => {
    globalThis.fetch = (async () => new Response('quota', { status: 429 })) as typeof fetch;
    const r = await createWhatsAppSender({
      url: 'https://graph.facebook.com/v25.0/x/messages',
      token: 'tok',
    }).sendOtp('+55', '123456');
    expect(r.status).toBe('failed');
    expect(r.error).toContain('429');
  });

  test('fetch lança → failed, não propaga', async () => {
    globalThis.fetch = (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    const r = await createWhatsAppSender({
      url: 'https://graph.facebook.com/v25.0/x/messages',
      token: 'tok',
    }).sendOtp('+55', '123456');
    expect(r.status).toBe('failed');
    expect(r.error).toContain('ECONNREFUSED');
  });
});