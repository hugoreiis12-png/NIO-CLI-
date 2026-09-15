import { test, expect, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gatewayHealth, resolveGatewayCommand, releaseDrift, classifyGatewayVersion, checkGatewayVersion, isLocalGatewayUrl } from './gateway-process.js';
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

test('releaseDrift: same/patch/minor/major ignorando sufixo', () => {
  expect(releaseDrift('0.10.1', '0.10.1')).toBe('same');
  expect(releaseDrift('0.10.2', '0.10.1')).toBe('patch');
  expect(releaseDrift('0.11.0', '0.10.1')).toBe('minor');
  expect(releaseDrift('1.0.0', '0.10.1')).toBe('major');
  expect(releaseDrift('0.10.1-beta', '0.10.1')).toBe('same');
});

test('classifyGatewayVersion: igual→ok; patch→warn; CLI>gateway minor→block; gateway>CLI→warn; sem versão→warn', () => {
  expect(classifyGatewayVersion('0.10.1', { ok: true, version: '0.10.1' })).toEqual({ status: 'ok' });
  expect(classifyGatewayVersion('0.10.2', { ok: true, version: '0.10.1' }).status).toBe('warn');
  const block = classifyGatewayVersion('0.11.0', { ok: true, version: '0.10.1' });
  expect(block.status).toBe('block');
  expect(block.detail).toMatch(/atualize o gateway/i);
  expect(classifyGatewayVersion('0.10.1', { ok: true, version: '0.11.0' }).status).toBe('warn');
  expect(classifyGatewayVersion('0.10.1', { ok: true }).status).toBe('warn');
});

test('checkGatewayVersion: lê /health via fetch e classifica; rede fora → warn sem lançar', async () => {
  globalThis.fetch = (async () => new Response('{"ok":true,"version":"0.9.0"}', { status: 200 })) as typeof fetch;
  expect(await checkGatewayVersion('http://x')).toEqual({
    status: 'block',
    detail: expect.stringMatching(/atualize o gateway/i),
  });
  globalThis.fetch = (async () => {
    throw new Error('ECONNREFUSED');
  }) as typeof fetch;
  expect((await checkGatewayVersion('http://x')).status).toBe('warn');
});

test('isLocalGatewayUrl: loopback na porta do gateway → true; resto → false', () => {
  expect(isLocalGatewayUrl('http://127.0.0.1:3000')).toBe(true);
  expect(isLocalGatewayUrl('http://localhost:3000/health')).toBe(true);
  expect(isLocalGatewayUrl('http://127.0.0.1:3001')).toBe(false);
  expect(isLocalGatewayUrl('http://192.168.0.160:8080')).toBe(false);
  expect(isLocalGatewayUrl('http://192.168.0.160:3000')).toBe(false);
  expect(isLocalGatewayUrl('nota-url')).toBe(false);
});
