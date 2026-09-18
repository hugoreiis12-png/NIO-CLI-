import { test, expect, afterEach } from 'bun:test';
import { shutdown } from './shutdown.js';

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__nioPgPoolOpen;
});

/** Spy do exit code pedido — não toca o global real (bun test o compartilha e sairia non-zero). */
function makeExitSpy(): { set: (code: number) => void; codes: number[] } {
  const codes: number[] = [];
  return { set: (code) => codes.push(code), codes };
}

test('shutdown: seta exitCode sem derrubar o runner (sem saída forçada)', async () => {
  const spy = makeExitSpy();
  await shutdown(3, { forceExitAfterMs: -1, setExitCode: spy.set });
  expect(spy.codes).toEqual([3]);
});

test('shutdown: sem pool aberto não puxa o pg nem lança', async () => {
  const spy = makeExitSpy();
  await shutdown(0, { forceExitAfterMs: -1, setExitCode: spy.set });
  expect(spy.codes).toEqual([0]);
});

test('shutdown: com flag de pool e sem pool real não lança (fallback silencioso)', async () => {
  (globalThis as Record<string, unknown>).__nioPgPoolOpen = true;
  const spy = makeExitSpy();
  await shutdown(1, { forceExitAfterMs: -1, setExitCode: spy.set });
  expect(spy.codes).toEqual([1]);
});
