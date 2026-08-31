import { test, expect } from 'bun:test';
import { buildPalette, filterPalette } from './palette-source.js';
import { buildProgram } from '../cli/program.js';

const items = buildPalette(buildProgram());

test('buildPalette: tem comandos, capacidades e ajuda', () => {
  const kinds = new Set(items.map((i) => i.kind));
  expect(kinds.has('command')).toBe(true);
  expect(kinds.has('capability')).toBe(true);
  expect(kinds.has('help')).toBe(true);
});

test('buildPalette: comando conhecido tem a linha `nio ...` e é ordenado', () => {
  const init = items.find((i) => i.kind === 'command' && i.name === 'init');
  expect(init).toBeDefined();
  expect((init as { line: string }).line).toBe('nio init');

  const cmds = items.filter((i) => i.kind === 'command').map((i) => i.name);
  expect([...cmds]).toEqual([...cmds].sort());
});

test('buildPalette: `docker headroom down` marcado destructive; `ai` capability tem prompt pt-BR', () => {
  const down = items.find((i) => i.kind === 'command' && i.name.includes('headroom down'));
  expect((down as { destructive: boolean }).destructive).toBe(true);

  const cap = items.find((i) => i.kind === 'capability' && i.name === 'nio_env_materialize');
  expect((cap as { prompt: string }).prompt).toMatch(/[Mm]aterialize/);
});

test('filterPalette: substring sobre nome+desc', () => {
  expect(filterPalette(items, 'headroom').every((i) => `${i.name} ${i.desc}`.toLowerCase().includes('headroom'))).toBe(true);
  expect(filterPalette(items, '').length).toBe(items.length);
});
