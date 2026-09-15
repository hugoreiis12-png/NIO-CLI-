import { test, expect, afterEach } from 'bun:test';
import { shutdown } from './shutdown.js';

const savedExitCode = process.exitCode;
afterEach(() => {
  process.exitCode = savedExitCode;
  delete (globalThis as Record<string, unknown>).__nioPgPoolOpen;
});

test('shutdown: seta exitCode sem derrubar o runner (sem saída forçada)', async () => {
  await shutdown(3, { forceExitAfterMs: -1 });
  expect(process.exitCode).toBe(3);
});

test('shutdown: sem pool aberto não puxa o pg nem lança', async () => {
  await shutdown(0, { forceExitAfterMs: -1 });
  expect(process.exitCode).toBe(0);
});

test('shutdown: com flag de pool e sem pool real não lança (fallback silencioso)', async () => {
  (globalThis as Record<string, unknown>).__nioPgPoolOpen = true;
  await shutdown(1, { forceExitAfterMs: -1 });
  expect(process.exitCode).toBe(1);
});
