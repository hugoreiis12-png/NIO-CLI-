import { test, expect, afterEach } from 'bun:test';
import { detectPrimaryClient, isPrimaryClient, PRIMARY_PRIORITY } from './primary-client.js';

const ORIG = process.env.NIO_PRIMARY_CLIENT;
afterEach(() => {
  if (ORIG === undefined) delete process.env.NIO_PRIMARY_CLIENT;
  else process.env.NIO_PRIMARY_CLIENT = ORIG;
});

/** Fake `isInstalled` — só os binários listados existem. */
const only = (...bins: string[]) => (bin: string) => bins.includes(bin);

test('PRIMARY_PRIORITY: opencode antes de codex', () => {
  expect([...PRIMARY_PRIORITY]).toEqual(['opencode', 'codex']);
});

test('isPrimaryClient', () => {
  expect(isPrimaryClient('opencode')).toBe(true);
  expect(isPrimaryClient('codex')).toBe(true);
  expect(isPrimaryClient('claude')).toBe(false);
  expect(isPrimaryClient(undefined)).toBe(false);
});

test('só opencode instalado → chosen opencode', () => {
  const d = detectPrimaryClient(null, only('opencode'));
  expect(d).toEqual({ chosen: 'opencode', installed: ['opencode'] });
});

test('só codex instalado → chosen codex', () => {
  const d = detectPrimaryClient(null, only('codex'));
  expect(d).toEqual({ chosen: 'codex', installed: ['codex'] });
});

test('nenhum instalado → chosen null', () => {
  expect(detectPrimaryClient(null, only())).toEqual({ chosen: null, installed: [] });
});

test('ambos instalados → opencode por prioridade', () => {
  const d = detectPrimaryClient(null, only('opencode', 'codex'));
  expect(d.chosen).toBe('opencode');
  expect(d.installed).toEqual(['opencode', 'codex']);
});

test('ambos instalados + hint codex → codex', () => {
  expect(detectPrimaryClient('codex', only('opencode', 'codex')).chosen).toBe('codex');
});

test('hint codex mas só opencode instalado → cai pra opencode', () => {
  expect(detectPrimaryClient('codex', only('opencode')).chosen).toBe('opencode');
});

test('NIO_PRIMARY_CLIENT tem precedência sobre o hint', () => {
  process.env.NIO_PRIMARY_CLIENT = 'codex';
  expect(detectPrimaryClient('opencode', only('opencode', 'codex')).chosen).toBe('codex');
});

test('NIO_PRIMARY_CLIENT ignorado se o binário não existe', () => {
  process.env.NIO_PRIMARY_CLIENT = 'codex';
  expect(detectPrimaryClient(null, only('opencode')).chosen).toBe('opencode');
});
