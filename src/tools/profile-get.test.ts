import { test, expect } from 'bun:test';
import { definition, handler } from './profile-get.js';
import type { ToolContext } from './index.js';

const textOf = (r: { content: Array<{ text?: string }> }) => r.content[0]?.text ?? '';
const ctx = {} as ToolContext; // profile_get não usa o contexto

test('definition: nome prefixado e schema fechado', () => {
  expect(definition.name).toBe('nio_profile_get');
  expect(definition.inputSchema.additionalProperties).toBe(false);
});

test('sem profile: lista os 6 perfis resumidos', async () => {
  const r = await handler({}, ctx);
  expect(r.isError).toBeFalsy();
  const out = JSON.parse(textOf(r));
  expect(out.profiles).toHaveLength(6);
  const dba = out.profiles.find((p: { profile: string }) => p.profile === 'dba');
  expect(dba.mcps).toContain('postgres');
  expect(dba.toolchains).toContain('postgresql-client');
  expect(dba).not.toHaveProperty('mcpSpecs'); // resumo não traz os comandos
});

test('com profile: definição completa com os comandos dos MCPs', async () => {
  const r = await handler({ profile: 'dba' }, ctx);
  const out = JSON.parse(textOf(r));
  expect(out.profile).toBe('dba');
  expect(Array.isArray(out.mcpSpecs)).toBe(true);
  expect(out.mcpSpecs.some((m: { id: string }) => m.id === 'postgres')).toBe(true);
  expect(out.toolchainSpecs[0].id).toBe('postgresql-client');
});

test('profile inválido: errorResult, sem lançar', async () => {
  const r = await handler({ profile: 'ceo' }, ctx);
  expect(r.isError).toBe(true);
});

test('arg desconhecido: rejeitado pelo schema', async () => {
  const r = await handler({ foo: 1 }, ctx);
  expect(r.isError).toBe(true);
  expect(textOf(r)).toMatch(/inválido/);
});
