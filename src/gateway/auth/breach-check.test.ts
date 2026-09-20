import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { checkPasswordBreach } from './breach-check.js';

const realFetch = globalThis.fetch;
beforeEach(() => {
  // outros arquivos de teste setam NIO_HIBP_DISABLE no escopo do módulo — aqui a
  // gente controla explicitamente por teste.
  delete process.env.NIO_HIBP_DISABLE;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.NIO_HIBP_DISABLE;
});

describe('checkPasswordBreach — camada local', () => {
  test('senha comum → breached/common (sem tocar a rede)', async () => {
    globalThis.fetch = (() => {
      throw new Error('não deveria chamar a rede');
    }) as typeof fetch;
    expect(await checkPasswordBreach('password')).toEqual({ breached: true, source: 'common' });
    expect(await checkPasswordBreach('QWERTY123')).toEqual({ breached: true, source: 'common' });
  });

  test('NIO_HIBP_DISABLE=1 → só a lista local; senha forte passa', async () => {
    process.env.NIO_HIBP_DISABLE = '1';
    globalThis.fetch = (() => {
      throw new Error('HIBP desligado');
    }) as typeof fetch;
    expect(await checkPasswordBreach('nK9$rT2p!vZ7wq-Larm')).toEqual({ breached: false });
  });
});

describe('checkPasswordBreach — camada HIBP (mock)', () => {
  test('sufixo presente na resposta → breached/pwned', async () => {
    // SHA-1("hunter2") = F3BBB D66A63D4BF1747940578EC3D0103530E21D (prefixo + sufixo)
    globalThis.fetch = (async () =>
      new Response('0000000000000000000000000000000000000:0\nD66A63D4BF1747940578EC3D0103530E21D:42\n', {
        status: 200,
      })) as typeof fetch;
    expect(await checkPasswordBreach('hunter2')).toEqual({ breached: true, source: 'pwned' });
  });

  test('sufixo ausente → breached:false', async () => {
    globalThis.fetch = (async () => new Response('0000000000000000000000000000000000000:1\n', { status: 200 })) as typeof fetch;
    expect(await checkPasswordBreach('uma-senha-que-nao-vazou-123')).toEqual({ breached: false });
  });

  test('rede fora / erro HTTP → fail-open (breached:false)', async () => {
    globalThis.fetch = (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    expect(await checkPasswordBreach('uma-senha-que-nao-vazou-123')).toEqual({ breached: false });

    globalThis.fetch = (async () => new Response('nope', { status: 503 })) as typeof fetch;
    expect(await checkPasswordBreach('uma-senha-que-nao-vazou-123')).toEqual({ breached: false });
  });
});
