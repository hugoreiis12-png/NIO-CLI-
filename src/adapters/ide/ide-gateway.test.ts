import { test, expect } from 'bun:test';
import { resolveLauncher, createIdeGateway } from './ide-gateway.js';

test('resolveLauncher: vscode → code', () => {
  expect(resolveLauncher('vscode')).toEqual({ binary: 'code' });
});

test('resolveLauncher: cursor → cursor', () => {
  expect(resolveLauncher('cursor')).toEqual({ binary: 'cursor' });
});

test('resolveLauncher: terminal/other → null (sem editor pra abrir)', () => {
  expect(resolveLauncher('terminal')).toBeNull();
  expect(resolveLauncher('other')).toBeNull();
});

test('open: ide sem launcher → skipped (não toca no host, nunca lança)', async () => {
  const res = await createIdeGateway().open('terminal', process.cwd());
  expect(res.status).toBe('skipped');
  expect(res.ide).toBe('terminal');
});
