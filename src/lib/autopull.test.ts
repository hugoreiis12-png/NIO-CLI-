import { test, expect } from 'bun:test';
import { shouldRunAutoPull, pickProvisionTarget } from './autopull.js';
import { opencodeTarget, codexTarget } from './targets.js';

// ponytail: só as decisões puras extraídas de `main` — a orquestração em si
// (wiring de handlers, I/O) é coberta pelo smoke test manual, não aqui.

test('shouldRunAutoPull: roda por padrão sem flag', () => {
  expect(shouldRunAutoPull(undefined, undefined)).toBe(true);
});

test('shouldRunAutoPull: pula quando NIO_AUTO_PULL=0', () => {
  expect(shouldRunAutoPull(undefined, '0')).toBe(false);
});

test('shouldRunAutoPull: pula quando NIO_AUTO_PULL=false', () => {
  expect(shouldRunAutoPull(undefined, 'false')).toBe(false);
});

test('shouldRunAutoPull: roda pra qualquer client com flag diferente de 0/false', () => {
  expect(shouldRunAutoPull('opencode', '1')).toBe(true);
});

test('pickProvisionTarget: codex → codexTarget; o resto → opencodeTarget', () => {
  expect(pickProvisionTarget(undefined)).toBe(opencodeTarget);
  expect(pickProvisionTarget('opencode')).toBe(opencodeTarget);
  expect(pickProvisionTarget('cowork')).toBe(opencodeTarget);
  expect(pickProvisionTarget('codex')).toBe(codexTarget);
});
