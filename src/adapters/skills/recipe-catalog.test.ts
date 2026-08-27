import { test, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRecipeCatalog } from './recipe-catalog.js';

let scratch: string | null = null;

function seed(files: Record<string, string>): string {
  scratch = mkdtempSync(join(tmpdir(), 'nio-recipes-'));
  const dir = join(scratch, 'recipes');
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return scratch;
}

afterEach(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  scratch = null;
});

const NEXT = `---
title: Fullstack Next.js + Prisma
description: Setup padrão web TS
profile: fullstack
languages: typescript, javascript
frameworks: next, prisma
toolchains: node
mcps: nio-lang
envVars: NODE_ENV=development, PORT=3000
aliases: nr=npm run
---
Notas pro operador.
`;

const ANALYST = `---
title: Analyst Postgres
description: ETL + consulta
profile: analyst
languages: python, sql
mcps: postgres
---
`;

test('list: parseia frontmatter completo em EnvironmentRecipe', () => {
  const cat = createRecipeCatalog(seed({ 'fullstack-next.md': NEXT }));
  const [r] = cat.list();
  expect(r.slug).toBe('fullstack-next');
  expect(r.profile).toBe('fullstack');
  expect(r.languages).toEqual(['typescript', 'javascript']);
  expect(r.frameworks).toEqual(['next', 'prisma']);
  expect(r.toolchainIds).toEqual(['node']);
  expect(r.mcpIds).toEqual(['nio-lang']);
  expect(r.envVars).toEqual({ NODE_ENV: 'development', PORT: '3000' });
  expect(r.aliases).toEqual({ nr: 'npm run' });
  expect(r.notes).toBe('Notas pro operador.');
});

test('list(profile): filtra pelo perfil', () => {
  const cat = createRecipeCatalog(seed({ 'a.md': NEXT, 'b.md': ANALYST }));
  expect(cat.list('fullstack').map((r) => r.slug)).toEqual(['a']);
  expect(cat.list('analyst').map((r) => r.slug)).toEqual(['b']);
  expect(cat.list('dba')).toEqual([]);
});

test('list: campos opcionais ausentes → vazios', () => {
  const cat = createRecipeCatalog(seed({ 'b.md': ANALYST }));
  const [r] = cat.list();
  expect(r.frameworks).toEqual([]);
  expect(r.toolchainIds).toEqual([]);
  expect(r.envVars).toEqual({});
  expect(r.aliases).toEqual({});
});

test('list: profile inválido/ausente → recipe ignorada', () => {
  const bad = `---\ntitle: X\nprofile: ceo\n---\n`;
  const noProfile = `---\ntitle: Y\n---\n`;
  const cat = createRecipeCatalog(seed({ 'bad.md': bad, 'np.md': noProfile, 'ok.md': ANALYST }));
  expect(cat.list().map((r) => r.slug)).toEqual(['ok']);
});

test('get: por slug; README.md ignorado', () => {
  const cat = createRecipeCatalog(seed({ 'fullstack-next.md': NEXT, 'README.md': '# recipes' }));
  expect(cat.get('fullstack-next')?.title).toBe('Fullstack Next.js + Prisma');
  expect(cat.get('README')).toBeNull();
  expect(cat.get('inexistente')).toBeNull();
});

test('recipes/ ausente → list vazio (não quebra)', () => {
  scratch = mkdtempSync(join(tmpdir(), 'nio-recipes-'));
  expect(createRecipeCatalog(scratch).list()).toEqual([]);
});

test('dir vazio (skills não baixadas) → list vazio', () => {
  expect(createRecipeCatalog('').list()).toEqual([]);
});
