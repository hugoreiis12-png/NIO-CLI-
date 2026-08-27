import { test, expect } from 'bun:test';
import { createProfileCatalog } from './index.js';
import type { Profile } from '../core/session.js';

const ALL_PROFILES: Profile[] = ['fullstack', 'analyst', 'scientist', 'dba', 'qa', 'bi'];

test('ProfileCatalog.get: devolve a definição de um perfil implementado', () => {
  const catalog = createProfileCatalog();
  const def = catalog.get('dba');
  expect(def.profile).toBe('dba');
  expect(def.mcps.length).toBeGreaterThan(0);
  expect(def.toolchains.length).toBeGreaterThan(0);
});

test('ProfileCatalog.get: os 6 perfis resolvem e batem o próprio nome', () => {
  const catalog = createProfileCatalog();
  for (const p of ALL_PROFILES) {
    expect(catalog.get(p).profile).toBe(p);
  }
});

test('powerbi-modeling é exclusivo de analyst e bi (nunca nos outros)', () => {
  const catalog = createProfileCatalog();
  const has = (p: Profile) => catalog.get(p).mcps.some((m) => m.id === 'powerbi-modeling');
  expect(has('analyst')).toBe(true);
  expect(has('bi')).toBe(true);
  for (const p of ['fullstack', 'scientist', 'dba', 'qa'] as Profile[]) {
    expect(has(p)).toBe(false);
  }
});

test('ProfileCatalog.list: devolve os 6 perfis modelados', () => {
  const catalog = createProfileCatalog();
  const ids = catalog.list().map((d) => d.profile).sort();
  expect(ids).toEqual([...ALL_PROFILES].sort());
});

test('ProfileCatalog.get: perfil inexistente lança erro claro', () => {
  const catalog = createProfileCatalog();
  expect(() => catalog.get('inexistente' as Profile)).toThrow(/ainda não tem ambiente definido/);
});
