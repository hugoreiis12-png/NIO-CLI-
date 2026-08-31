import { test, expect, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gatewayHealth, resolveGatewayCommand } from './gateway-process.js';
import { isBinaryInstalled } from '../clients/client-install.js';

const gwBinOnPath = isBinaryInstalled('nio-gateway');

const realFetch = globalThis.fetch;
const realArgv1 = process.argv[1];
afterEach(() => {
  globalThis.fetch = realFetch;
  process.argv[1] = realArgv1;
});

test('gatewayHealth: status 200 → true', async () => {
  globalThis.fetch = (async () => new Response('{"ok":true}', { status: 200 })) as typeof fetch;
  expect(await gatewayHealth()).toBe(true);
});

test('gatewayHealth: status != 200 → false', async () => {
  globalThis.fetch = (async () => new Response('nope', { status: 503 })) as typeof fetch;
  expect(await gatewayHealth()).toBe(false);
});

test('gatewayHealth: fetch rejeita (gateway fora) → false, não lança', async () => {
  globalThis.fetch = (async () => {
    throw new Error('ECONNREFUSED');
  }) as typeof fetch;
  expect(await gatewayHealth()).toBe(false);
});

test.skipIf(gwBinOnPath)('resolveGatewayCommand: acha o gateway/index.js irmão do entrypoint', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nio-gw-'));
  try {
    mkdirSync(join(dir, 'gateway'), { recursive: true });
    writeFileSync(join(dir, 'gateway', 'index.js'), '');
    process.argv[1] = join(dir, 'cli.js');
    expect(resolveGatewayCommand()).toEqual({
      cmd: process.execPath,
      args: [join(dir, 'gateway', 'index.js')],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveGatewayCommand: bin no PATH → usa ele; senão sem irmão → null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nio-gw-'));
  try {
    process.argv[1] = join(dir, 'cli.js');
    expect(resolveGatewayCommand()).toEqual(
      gwBinOnPath ? { cmd: 'nio-gateway', args: [] } : null,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
