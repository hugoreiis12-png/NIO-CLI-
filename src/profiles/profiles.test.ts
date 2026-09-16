import { test, expect } from 'bun:test';
import { createProfileCatalog } from './index.js';
import type { Profile } from '../core/types.js';

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

test('powerbi-modeling + excel(herdado) nos perfis analytics; fora de fullstack/qa', () => {
  const catalog = createProfileCatalog();
  const hasPowerbi = (p: Profile) => catalog.get(p).mcps.some((m) => m.id === 'powerbi-modeling');
  const inheritsExcel = (p: Profile) => (catalog.get(p).inheritGlobalMcpIds ?? []).includes('excel');
  for (const p of ['analyst', 'bi', 'scientist', 'dba'] as Profile[]) {
    expect(hasPowerbi(p)).toBe(true);
    expect(inheritsExcel(p)).toBe(true);
  }
  for (const p of ['fullstack', 'qa'] as Profile[]) {
    expect(hasPowerbi(p)).toBe(false);
    expect(inheritsExcel(p)).toBe(false);
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

test('bi materializa toolchains locais (psql + Power BI Desktop)', () => {
  const catalog = createProfileCatalog();
  const ids = catalog.get('bi').toolchains.map((t) => t.id);
  expect(ids).toEqual(['postgresql-client', 'powerbi-desktop']);
});

test('dba reusa o postgresql-client centralizado', () => {
  const catalog = createProfileCatalog();
  const ids = catalog.get('dba').toolchains.map((t) => t.id);
  expect(ids).toContain('postgresql-client');
});
