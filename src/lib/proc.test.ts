import { test, expect } from 'bun:test';
import { binaryOnPath, spawnSyncPortable } from './proc.js';

// `node` existe em toda plataforma (é o próprio runtime) — sanity check de que o
// helper acha e roda um binário e propaga o exit code.
test('spawnSyncPortable: acha o node e roda --version (sem error)', () => {
  const res = spawnSyncPortable('node', ['--version'], { stdio: 'ignore', timeout: 5000 });
  expect(res.error).toBeUndefined();
  expect(res.status).toBe(0);
});

test('spawnSyncPortable: binário ausente → falha (error no POSIX, exit!=0 no Windows via shell)', () => {
  const res = spawnSyncPortable('this-binary-does-not-exist-xyz', ['--version'], { stdio: 'ignore', timeout: 5000 });
  const falhou = Boolean(res.error) || (res.status !== 0 && res.status !== null);
  expect(falhou).toBe(true);
});

test('binaryOnPath: acha o runtime atual pelo caminho absoluto; nome inexistente → false', () => {
  expect(binaryOnPath(process.execPath)).toBe(true);
  expect(binaryOnPath('this-binary-does-not-exist-xyz')).toBe(false);
});

test('binaryOnPath: acha "node" no PATH sem executar', () => {
  // `node` é o próprio runtime — está no PATH em toda plataforma de CI/dev.
  expect(binaryOnPath('node')).toBe(true);
});
