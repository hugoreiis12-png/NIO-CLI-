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

test('excel(modelado + herdado) nos perfis analytics; fora de fullstack/qa', () => {
  const catalog = createProfileCatalog();
  const hasExcel = (p: Profile) => catalog.get(p).mcps.some((m) => m.id === 'excel');
  const inheritsExcel = (p: Profile) => (catalog.get(p).inheritGlobalMcpIds ?? []).includes('excel');
  for (const p of ['analyst', 'bi', 'scientist', 'dba'] as Profile[]) {
    expect(hasExcel(p)).toBe(true); // modelado (semeado no global), não só herdado
    expect(inheritsExcel(p)).toBe(true);
  }
  for (const p of ['fullstack', 'qa'] as Profile[]) {
    expect(hasExcel(p)).toBe(false);
    expect(inheritsExcel(p)).toBe(false);
  }
});

test('ACEITE: powerbi-modeling é SÓ do perfil bi', () => {
  // Ele modela o arquivo aberto no Power BI Desktop — é trabalho de BI, não de análise
  // nem de DBA. Os outros perfis acessam o Power BI pela nuvem, via nio_fabric_* (REST),
  // que não exige XMLA nem modelo aberto. Cada tool a menos é prefixo que não se paga.
  const catalog = createProfileCatalog();
  const temPowerbi = (p: Profile) => catalog.get(p).mcps.some((m) => m.id === 'powerbi-modeling');

  expect(temPowerbi('bi')).toBe(true);
  for (const p of ['analyst', 'scientist', 'dba', 'fullstack', 'qa'] as Profile[]) {
    expect(temPowerbi(p)).toBe(false);
  }
});

test('as tools nio_fabric_* seguem valendo para TODO perfil (vêm do MCP nio, não do perfil)', () => {
  // A mudança acima não tira Fabric de ninguém: o acesso REST vem do MCP `nio`, que é
  // registrado sempre. Só o caminho XMLA/local ficou restrito ao bi.
  const catalog = createProfileCatalog();
  for (const p of ['analyst', 'bi', 'scientist', 'dba', 'fullstack', 'qa'] as Profile[]) {
    expect(catalog.get(p).mcps.some((m) => m.id === 'nio')).toBe(false); // não é do perfil…
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
