import { afterEach, describe, expect, test } from 'bun:test';
import {
  buildContext,
  clientIp,
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

  test('TP-6: trace-id gigante do cliente é capado em 64 chars', () => {
    const ctx = buildContext(req({ headers: { 'x-nio-trace-id': 'z'.repeat(5000) } }));
    expect(ctx.traceId).toHaveLength(64);
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

describe('clientIp (ADR 0011 §F)', () => {
  const orig = process.env.NIO_TRUST_PROXY;
  afterEach(() => {
    if (orig === undefined) delete process.env.NIO_TRUST_PROXY;
    else process.env.NIO_TRUST_PROXY = orig;
  });
  const withSocket = (o: Partial<FilterableRequest> & { socket?: { remoteAddress?: string } } = {}) => ({
    headers: {},
    ...o,
  });

  test('sem NIO_TRUST_PROXY: usa o remoteAddress do socket, ignora XFF', () => {
    delete process.env.NIO_TRUST_PROXY;
    const r = withSocket({ headers: { 'x-forwarded-for': '1.2.3.4' }, socket: { remoteAddress: '10.0.0.5' } });
    expect(clientIp(r)).toBe('10.0.0.5');
  });

  test('com NIO_TRUST_PROXY=1: pega o 1º IP do X-Forwarded-For', () => {
    process.env.NIO_TRUST_PROXY = '1';
    const r = withSocket({ headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }, socket: { remoteAddress: '10.0.0.1' } });
    expect(clientIp(r)).toBe('203.0.113.7');
  });

  test('com NIO_TRUST_PROXY mas sem XFF: cai no socket', () => {
    process.env.NIO_TRUST_PROXY = 'true';
    expect(clientIp(withSocket({ socket: { remoteAddress: '10.0.0.9' } }))).toBe('10.0.0.9');
  });

  test('normaliza IPv4-mapeado (::ffff:)', () => {
    delete process.env.NIO_TRUST_PROXY;
    expect(clientIp(withSocket({ socket: { remoteAddress: '::ffff:192.168.1.20' } }))).toBe('192.168.1.20');
  });

  test('sem socket nem XFF → null', () => {
    delete process.env.NIO_TRUST_PROXY;
    expect(clientIp(withSocket())).toBeNull();
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
