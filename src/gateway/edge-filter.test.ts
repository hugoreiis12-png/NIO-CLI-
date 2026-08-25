import { describe, expect, test } from 'bun:test';
import {
  buildContext,
  extractGatewayToken,
  hasBrowserOrigin,
  tokensMatch,
  type FilterableRequest,
} from './edge-filter.js';

function req(overrides: Partial<FilterableRequest> = {}): FilterableRequest {
  return { headers: {}, method: 'POST', url: '/login', ...overrides };
}

describe('buildContext', () => {
  test('extrai método e path (sem query string)', () => {
    const ctx = buildContext(req({ url: '/login?foo=bar' }));
    expect(ctx.method).toBe('POST');
    expect(ctx.path).toBe('/login');
  });

  test('gera um traceId quando não veio no header', () => {
    const ctx = buildContext(req());
    expect(ctx.traceId.length).toBeGreaterThan(0);
  });

  test('reaproveita x-nio-trace-id do header quando presente', () => {
    const ctx = buildContext(req({ headers: { 'x-nio-trace-id': 'abc-123' } }));
    expect(ctx.traceId).toBe('abc-123');
  });

  test('lida com header duplicado (array) pegando o primeiro', () => {
    const ctx = buildContext(req({ headers: { 'x-nio-trace-id': ['first', 'second'] } }));
    expect(ctx.traceId).toBe('first');
  });

  test('method/url ausentes viram defaults sensatos', () => {
    const ctx = buildContext({ headers: {} });
    expect(ctx.method).toBe('UNKNOWN');
    expect(ctx.path).toBe('/');
  });
});

describe('hasBrowserOrigin', () => {
  test('true quando o header Origin está presente (browser)', () => {
    expect(hasBrowserOrigin(req({ headers: { origin: 'https://malicioso.example' } }))).toBe(true);
  });

  test('false sem header Origin (CLI/curl)', () => {
    expect(hasBrowserOrigin(req())).toBe(false);
  });

  test('false pra Origin vazio', () => {
    expect(hasBrowserOrigin(req({ headers: { origin: '' } }))).toBe(false);
  });
});

describe('extractGatewayToken', () => {
  test('extrai o valor do header x-nio-gateway-token', () => {
    expect(extractGatewayToken(req({ headers: { 'x-nio-gateway-token': 'abc' } }))).toBe('abc');
  });

  test('null quando ausente', () => {
    expect(extractGatewayToken(req())).toBeNull();
  });

  test('pega o primeiro valor se vier duplicado (array)', () => {
    expect(extractGatewayToken(req({ headers: { 'x-nio-gateway-token': ['a', 'b'] } }))).toBe('a');
  });
});

describe('tokensMatch', () => {
  test('true quando os tokens batem', () => {
    expect(tokensMatch('segredo-123', 'segredo-123')).toBe(true);
  });

  test('false quando não batem', () => {
    expect(tokensMatch('errado', 'segredo-123')).toBe(false);
  });

  test('false quando o fornecido é null', () => {
    expect(tokensMatch(null, 'segredo-123')).toBe(false);
  });

  test('false com tamanhos diferentes (sem lançar erro)', () => {
    expect(tokensMatch('curto', 'um-token-bem-mais-longo-que-o-outro')).toBe(false);
  });
});
