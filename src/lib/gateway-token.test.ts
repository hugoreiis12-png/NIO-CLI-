import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getOrCreateGatewayToken } from './gateway-token.js';

describe('getOrCreateGatewayToken', () => {
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
  });

  test('dois arquivos diferentes geram tokens diferentes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nio-gw-token-'));
    try {
      const a = await getOrCreateGatewayToken(join(dir, 'a.token'));
      const b = await getOrCreateGatewayToken(join(dir, 'b.token'));
      expect(a).not.toBe(b);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
