import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getOrCreateGatewayToken } from './gateway-token.js';

describe('getOrCreateGatewayToken', () => {
  // Hermético: o Bun auto-carrega o `.env` no `bun test`; sem limpar, o
  // `NIO_GATEWAY_TOKEN` curto-circuita a função e os dois "arquivos" viriam iguais.
  let savedToken: string | undefined;
  beforeEach(() => {
    savedToken = process.env.NIO_GATEWAY_TOKEN;
    delete process.env.NIO_GATEWAY_TOKEN;
  });
  afterEach(() => {
    if (savedToken === undefined) delete process.env.NIO_GATEWAY_TOKEN;
    else process.env.NIO_GATEWAY_TOKEN = savedToken;
  });

  test('gera um token na primeira chamada e reaproveita nas seguintes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nio-gw-token-'));
    const file = join(dir, 'gateway.token');
    try {
      const first = await getOrCreateGatewayToken(file);
      const second = await getOrCreateGatewayToken(file);
      expect(first).toBe(second);
      expect(first.length).toBeGreaterThan(20);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    // `hardenSecretFile` no Windows spawna `icacls` (QP-3) — bem mais caro que o
    // `chmodSync` que ele substituiu. Isolado passa em ~100ms; sob a suíte cheia
    // (contenção de processo/disco) já estourou os 5s default. Mesmo raciocínio
    // do § 11.1: timeout é honestidade sobre o custo de IO, não tapa-buraco.
  }, 30_000);

  test('dois arquivos diferentes geram tokens diferentes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nio-gw-token-'));
    try {
      const a = await getOrCreateGatewayToken(join(dir, 'a.token'));
      const b = await getOrCreateGatewayToken(join(dir, 'b.token'));
      expect(a).not.toBe(b);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000); // idem: 2 spawns de icacls neste teste, mesmo risco de contenção.
});
