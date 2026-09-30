import { test, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRefreshToken, saveRefreshToken, clearRefreshToken } from './refresh-store.js';

// Sempre em tmpdir: apontar para ~/.nio apagaria o login real de quem roda os testes.
const dirs: string[] = [];
const novoPath = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'nio-fabric-'));
  dirs.push(d);
  return join(d, 'fabric-auth.json');
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const SP = { tenantId: 't1', clientId: 'c1' };

test('save e read: ida e volta', () => {
  const p = novoPath();
  saveRefreshToken('rt-abc', SP, p);
  expect(readRefreshToken('t1', 'c1', p)).toBe('rt-abc');
});

test('arquivo ausente → null, não erro', () => {
  expect(readRefreshToken('t1', 'c1', novoPath())).toBeNull();
});

test('JSON corrompido → null, não erro', () => {
  const p = novoPath();
  saveRefreshToken('rt-abc', SP, p);
  writeFileSync(p, '{ isto não é json', 'utf8');
  expect(readRefreshToken('t1', 'c1', p)).toBeNull();
});

// Sem isto, trocar de app/tenant deixaria a CLI mandar um refresh de outra
// credencial e receber um erro opaco do Entra em vez de "faça login".
test('refresh de outro tenant é ignorado', () => {
  const p = novoPath();
  saveRefreshToken('rt-abc', SP, p);
  expect(readRefreshToken('OUTRO-TENANT', 'c1', p)).toBeNull();
});

test('refresh de outro client é ignorado', () => {
  const p = novoPath();
  saveRefreshToken('rt-abc', SP, p);
  expect(readRefreshToken('t1', 'OUTRO-CLIENT', p)).toBeNull();
});

test('sem filtro de credencial, devolve o que está salvo', () => {
  const p = novoPath();
  saveRefreshToken('rt-abc', SP, p);
  expect(readRefreshToken(undefined, undefined, p)).toBe('rt-abc');
});

test('clear esquece o login e é idempotente', () => {
  const p = novoPath();
  saveRefreshToken('rt-abc', SP, p);
  clearRefreshToken(p);
  expect(readRefreshToken('t1', 'c1', p)).toBeNull();
  clearRefreshToken(p); // segunda vez não é erro
  expect(readRefreshToken('t1', 'c1', p)).toBeNull();
});
