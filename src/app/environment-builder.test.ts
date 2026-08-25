import { test, expect } from 'bun:test';
import { EnvironmentBuilder } from './environment-builder.js';
import type { ToolchainGateway, EnsureResult } from '../core/environment.js';
import type { Profile } from '../core/session.js';

/** Gateway fake determinístico — devolve sempre o mesmo status por spec. */
function fakeGateway(status: EnsureResult['status']): ToolchainGateway {
  return { ensure: async (spec) => ({ id: spec.id, status }) };
}

test('build(dba): resolve o config com os ids dos MCPs e devolve os specs', async () => {
  const env = await new EnvironmentBuilder().build('dba');
  expect(env.config.mcps).toContain('postgres');
  expect(env.config.languages).toContain('sql');
  expect(env.mcps.some((m) => m.id === 'postgres')).toBe(true);
});

test('build: perfil inexistente no catálogo propaga o erro claro', async () => {
  await expect(new EnvironmentBuilder().build('inexistente' as Profile)).rejects.toThrow(
    /ainda não tem ambiente definido/,
  );
});

test('build(dba): toolchain materializado entra em config.toolchains', async () => {
  const env = await new EnvironmentBuilder(undefined, fakeGateway('present')).build('dba');
  expect(env.config.toolchains).toContain('postgresql-client');
  expect(env.toolchains[0]?.status).toBe('present');
});

test('build: nio-lang é MCP-base em todo perfil (inclusive um sem MCP próprio)', async () => {
  const bi = await new EnvironmentBuilder(undefined, fakeGateway('present')).build('bi');
  expect(bi.config.mcps).toContain('nio-lang');
  expect(bi.mcps.some((m) => m.id === 'nio-lang')).toBe(true);

  const dba = await new EnvironmentBuilder(undefined, fakeGateway('present')).build('dba');
  expect(dba.config.mcps).toEqual(expect.arrayContaining(['nio-lang', 'postgres']));
});

test('n8n-mcp NÃO é base — nenhum perfil o traz por default (só via seleção no wizard)', async () => {
  const profiles: Profile[] = ['fullstack', 'analyst', 'scientist', 'dba', 'qa', 'bi'];
  for (const p of profiles) {
    const env = await new EnvironmentBuilder(undefined, fakeGateway('present')).build(p);
    expect(env.config.mcps).not.toContain('n8n');
    expect(env.mcps.some((m) => m.id === 'n8n')).toBe(false);
  }
});

test('build(dba): toolchain que falha fica fora do config (não aborta)', async () => {
  const env = await new EnvironmentBuilder(undefined, fakeGateway('failed')).build('dba');
  expect(env.config.toolchains).toBeUndefined();
  expect(env.config.mcps).toContain('postgres'); // MCPs seguem materializando
  expect(env.toolchains[0]?.status).toBe('failed');
});
