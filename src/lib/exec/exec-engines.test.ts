import { test, expect, afterEach } from 'bun:test';
import { engineArgs, parseEngine, DEFAULT_ENGINE } from './exec-engines.js';

afterEach(() => {
  delete process.env.NIO_CODEX_ARGS;
  delete process.env.NIO_CLAUDE_ARGS;
});

test('codex monta o comando headless de hoje', () => {
  expect(engineArgs('codex', 'faz X')).toEqual(['exec', '--full-auto', 'faz X']);
});

test('claude monta o comando headless auto-aprovado', () => {
  expect(engineArgs('claude', 'faz X')).toEqual([
    '-p',
    'faz X',
    '--permission-mode',
    'acceptEdits',
  ]);
});

test('env sobrescreve os args, com o prompt no fim', () => {
  process.env.NIO_CLAUDE_ARGS = '-p --model opus';
  expect(engineArgs('claude', 'faz X')).toEqual(['-p', '--model', 'opus', 'faz X']);
});

test('engine ausente vira o default', () => {
  expect(parseEngine(undefined)).toBe(DEFAULT_ENGINE);
  expect(parseEngine('')).toBe(DEFAULT_ENGINE);
});

test('engine válido passa; inválido vira null', () => {
  expect(parseEngine('claude')).toBe('claude');
  expect(parseEngine('gemini')).toBeNull();
});
