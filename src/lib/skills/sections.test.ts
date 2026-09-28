import { test, expect, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { includePath, flattenSelection, discoverRoles, type Selection } from './sections.js';

const DEV: Selection = { roles: ['dev'], stacks: { 'front-end': 'nextjs' } };
const DATA: Selection = { roles: ['data'], stacks: { bi: 'general' } };

// --- core: sem role, vale pra todo mundo ---
// Antes de `core` ser tratado, `parts[1]` caía na checagem de role e tudo em
// skills/core/ era descartado em silêncio — o senior-engineering-core estava no
// repo e não chegava a nenhum usuário.
test('core entra para qualquer seleção de role', () => {
  expect(includePath('skills/core/fellow-bi/SKILL.md', DEV)).toBe(true);
  expect(includePath('skills/core/fellow-bi/SKILL.md', DATA)).toBe(true);
  expect(includePath('skills/core/x/SKILL.md', { roles: [], stacks: {} })).toBe(true);
});

test('core achata sem comer o nome da skill', () => {
  const [doc] = flattenSelection([{ relPath: 'skills/core/fellow-bi/SKILL.md' }]);
  expect(doc!.relPath).toBe('skills/fellow-bi/SKILL.md');
});

test('core não é oferecido como role no init', () => {
  const dir = novoDir();
  for (const r of ['core', 'data', 'dev']) mkdirSync(join(dir, 'skills', r), { recursive: true });
  expect(discoverRoles(dir)).toEqual(['data', 'dev']);
});

// --- gramática existente: não pode regredir ---
test('role não selecionado fica de fora', () => {
  expect(includePath('skills/data/general/kpi/SKILL.md', DEV)).toBe(false);
  expect(includePath('skills/dev/general/x/SKILL.md', DATA)).toBe(false);
});

test('general do role entra sempre', () => {
  expect(includePath('skills/dev/general/review/SKILL.md', DEV)).toBe(true);
});

test('área só entra se selecionada; dentro dela, general + o stack escolhido', () => {
  expect(includePath('skills/dev/front-end/general/a/SKILL.md', DEV)).toBe(true);
  expect(includePath('skills/dev/front-end/nextjs/a/SKILL.md', DEV)).toBe(true);
  expect(includePath('skills/dev/front-end/vue/a/SKILL.md', DEV)).toBe(false); // outra stack
  expect(includePath('skills/dev/back-end/general/a/SKILL.md', DEV)).toBe(false); // área não escolhida
});

test('commands e hooks são flat e sempre-dev', () => {
  expect(includePath('commands/build.md', DEV)).toBe(true);
  expect(includePath('commands/build.md', DATA)).toBe(false);
  expect(includePath('hooks/check.py', DEV)).toBe(true);
});

test('agents filtram por role e não têm área/stack', () => {
  expect(includePath('agents/dev/reviewer.md', DEV)).toBe(true);
  expect(includePath('agents/data/explorer.md', DEV)).toBe(false);
});

test('flatten dos demais ramos segue inalterado', () => {
  const docs = flattenSelection([
    { relPath: 'skills/dev/general/review/SKILL.md' },
    { relPath: 'skills/dev/front-end/nextjs/a/SKILL.md' },
    { relPath: 'agents/dev/reviewer.md' },
    { relPath: 'commands/build.md' },
  ]);
  expect(docs.map((d) => d.relPath)).toEqual([
    'skills/review/SKILL.md',
    'skills/a/SKILL.md',
    'agents/reviewer.md',
    'commands/build.md',
  ]);
});

const dirs: string[] = [];
function novoDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'nio-sections-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
