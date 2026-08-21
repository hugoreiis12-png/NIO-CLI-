import { test, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PLAN_TEMPLATE, buildPlanPrompt, planBase, stripFence } from './plan-delegate.js';
import { PLAN_ENGINE, DEFAULT_ENGINE, parseEngine } from './exec-engines.js';

const dirs: string[] = [];
function project(plan?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'nio-plan-'));
  dirs.push(dir);
  if (plan !== undefined) writeFileSync(join(dir, 'plan.md'), plan, 'utf8');
  return dir;
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

test('sem plan.md a base é o template semente', () => {
  expect(planBase(project())).toBe(PLAN_TEMPLATE);
});

test('com plan.md a base é o conteúdo atual', () => {
  expect(planBase(project('# Plano\n\nraciocínio anterior'))).toContain('raciocínio anterior');
});

test('plan.md vazio cai no template em vez de virar folha em branco', () => {
  expect(planBase(project('   \n'))).toBe(PLAN_TEMPLATE);
});

test('o prompt ancora no harness, proíbe código e carrega o plano atual', () => {
  const prompt = buildPlanPrompt('adicionar login', '# Plano\n\nraciocínio anterior');
  expect(prompt).toContain('docs/_rules/nio.md');
  expect(prompt).toContain('NÃO escreva código');
  expect(prompt).toContain('adicionar login');
  expect(prompt).toContain('raciocínio anterior');
});

test('cerca de código volta como markdown limpo', () => {
  expect(stripFence('```markdown\n# Plano\n```')).toBe('# Plano');
  expect(stripFence('# Plano\n')).toBe('# Plano');
});

test('o default do plan é o engine pensante, não o do exec', () => {
  expect(parseEngine(undefined, PLAN_ENGINE)).toBe(PLAN_ENGINE);
  expect(PLAN_ENGINE).not.toBe(DEFAULT_ENGINE);
});

test('engine inválido continua null mesmo com fallback pensante', () => {
  expect(parseEngine('gemini', PLAN_ENGINE)).toBeNull();
});
