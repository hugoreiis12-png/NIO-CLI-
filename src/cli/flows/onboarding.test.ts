import { test, expect } from 'bun:test';
import { resolveStage, type StageDeps } from './onboarding.js';

const future = new Date(Date.now() + 3_600_000).toISOString();
const past = new Date(Date.now() - 1_000).toISOString();

/** Deps "tudo ok" — cada teste degrada uma peça. */
const allOk: StageDeps = {
  configOk: async () => true,
  gatewayHealth: async () => true,
  loadSession: async () => ({ userId: 1, expiresAt: future }),
  findActive: async () => ({ id: 's1', name: 'demo', profile: 'fullstack' }),
};

test('resolveStage: config faltando → "config" (antes de tudo)', async () => {
  expect(await resolveStage({ ...allOk, configOk: async () => false })).toBe('config');
});

test('resolveStage: config ok, gateway fora → "gateway"', async () => {
  expect(await resolveStage({ ...allOk, gatewayHealth: async () => false })).toBe('gateway');
});

test('resolveStage: sem sessão local → "login"', async () => {
  expect(await resolveStage({ ...allOk, loadSession: async () => null })).toBe('login');
});

test('resolveStage: sessão local expirada → "login" (não "ready")', async () => {
  expect(
    await resolveStage({ ...allOk, loadSession: async () => ({ userId: 1, expiresAt: past }) }),
  ).toBe('login');
});

test('resolveStage: logado, sem sessão de ambiente ativa → "session"', async () => {
  expect(await resolveStage({ ...allOk, findActive: async () => null })).toBe('session');
});

test('resolveStage: tudo pronto → "ready"', async () => {
  expect(await resolveStage(allOk)).toBe('ready');
});
