import { test, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildValidatePrompt,
  parseVerdict,
  readPlan,
  planMissingError,
  suggestSlug,
} from './validate-plan-delegate.js';
import { PLAN_ENGINE, DEFAULT_ENGINE, parseEngine } from './exec-engines.js';

const dirs: string[] = [];
function project(plan?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'nio-validate-'));
  dirs.push(dir);
  if (plan !== undefined) writeFileSync(join(dir, 'plan.md'), plan, 'utf8');
  return dir;
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

test('readPlan devolve o conteúdo do plan.md', () => {
  expect(readPlan(project('# Plano\n\nmudança ampla'))).toContain('mudança ampla');
});

test('readPlan dispara quando não há plan.md', () => {
  expect(() => readPlan(project())).toThrow();
});

test('readPlan dispara quando o plan.md está vazio', () => {
  expect(() => readPlan(project('   \n'))).toThrow();
});

test('o prompt ancora no harness, proíbe código e pede formato parseável', () => {
  const prompt = buildValidatePrompt('# Plano\n\nmexer em muitos módulos');
  expect(prompt).toContain('docs/_rules/nio.md');
  expect(prompt).toContain('não escreva código');
  expect(prompt).toContain('VERDICT: yes|no');
  expect(prompt).toContain('mexer em muitos módulos');
});

test('veredito yes vira needsSpec true com reason legível', () => {
  const v = parseVerdict('VERDICT: yes\nREASON: toca muitos módulos e arquitetura.');
  expect(v.needsSpec).toBe(true);
  expect(v.reason).toBe('toca muitos módulos e arquitetura.');
});

test('veredito no vira needsSpec false', () => {
  const v = parseVerdict('VERDICT: no\nREASON: mudança pequena e localizada.');
  expect(v.needsSpec).toBe(false);
  expect(v.reason).toBe('mudança pequena e localizada.');
});

test('veredito com cerca de código e reason inline ainda normaliza', () => {
  const v = parseVerdict('```\nVERDICT: yes — risco alto, vários pontos de entrada\n```');
  expect(v.needsSpec).toBe(true);
  expect(v.reason).toBe('risco alto, vários pontos de entrada');
});

test('veredito ambíguo (sem VERDICT) vira erro, não um chute', () => {
  expect(() => parseVerdict('acho que talvez precise de spec')).toThrow();
});

test('veredito sem justificativa vira erro', () => {
  expect(() => parseVerdict('VERDICT: yes')).toThrow();
});

test('o default da triagem é o engine pensante, não o do exec', () => {
  expect(parseEngine(undefined, PLAN_ENGINE)).toBe(PLAN_ENGINE);
  expect(PLAN_ENGINE).not.toBe(DEFAULT_ENGINE);
});

test('engine inválido continua null mesmo com fallback pensante', () => {
  expect(parseEngine('gemini', PLAN_ENGINE)).toBeNull();
});

test('planMissingError nomeia o projeto e aponta o nio plan', () => {
  expect(planMissingError('/tmp/proj')).toContain('/tmp/proj');
  expect(planMissingError('/tmp/proj')).toContain('nio plan');
});

test('suggestSlug deriva do título em kebab-case', () => {
  expect(suggestSlug('# Add user login flow\n\nresto')).toBe('add-user-login-flow');
});

test('suggestSlug remove acentos e símbolos, colapsa hífens', () => {
  expect(suggestSlug('# Autenticação & Sessão (v2)!')).toBe('autenticacao-sessao-v2');
});

test('suggestSlug com título vazio/degenerado cai no fallback', () => {
  expect(suggestSlug('')).toBe('plan');
  expect(suggestSlug('# !!! @@@ ###\n')).toBe('plan');
});

test('suggestSlug corta no teto de comprimento sem deixar hífen na ponta', () => {
  const slug = suggestSlug(`# ${'palavra '.repeat(20)}`);
  expect(slug.length).toBeLessThanOrEqual(50);
  expect(slug.endsWith('-')).toBe(false);
  expect(slug).toMatch(/^[a-z0-9-]+$/);
});
