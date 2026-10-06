import { test, expect } from 'bun:test';
import { EnvironmentBuilder } from './environment-builder.js';
import type { ToolchainGateway, EnsureResult, EnvironmentRecipe } from '../core/environment.js';
import type { Profile } from '../core/types.js';

/** Gateway fake determinístico — devolve sempre o mesmo status por spec. */
function fakeGateway(status: EnsureResult['status']): ToolchainGateway {
  return { ensure: async (spec) => ({ id: spec.id, status }) };
}

function mkRecipe(over: Partial<EnvironmentRecipe> = {}): EnvironmentRecipe {
  return {
    slug: 'r1',
    title: 'R1',
    description: '',
    profile: 'dba',
    languages: [],
    frameworks: [],
    toolchainIds: [],
    mcpIds: [],
    envVars: {},
    aliases: {},
    notes: '',
    ...over,
  };
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

test('build + recipe: funde languages/frameworks/mcps/toolchains e grava extra.recipe', async () => {
  const recipe = mkRecipe({
    slug: 'fullstack-next',
    profile: 'fullstack',
    languages: ['typescript'],
    frameworks: ['next'],
    toolchainIds: ['python'], // conhecido, não está no perfil fullstack
    mcpIds: ['postgres'], // conhecido
    envVars: { NODE_ENV: 'development' },
    aliases: { nr: 'npm run' },
  });
  const env = await new EnvironmentBuilder(undefined, fakeGateway('present')).build(
    'fullstack',
    recipe,
  );

  expect(env.config.frameworks).toEqual(expect.arrayContaining(['react', 'next']));
  expect(env.config.mcps).toEqual(expect.arrayContaining(['nio-lang', 'postgres']));
  expect(env.config.toolchains).toEqual(expect.arrayContaining(['node', 'python']));
  expect(env.config.envVars).toMatchObject({ NODE_ENV: 'development' });
  expect(env.config.aliases).toMatchObject({ nr: 'npm run' });
  expect(env.config.extra).toEqual({ recipe: 'fullstack-next' });
  expect(env.recipeWarnings).toEqual([]);
});

test('build + recipe: id de toolchain/MCP desconhecido → recipeWarnings, não quebra', async () => {
  const recipe = mkRecipe({
    profile: 'dba',
    toolchainIds: ['cobol'],
    mcpIds: ['inventado'],
  });
  const env = await new EnvironmentBuilder(undefined, fakeGateway('present')).build('dba', recipe);
  expect(env.recipeWarnings).toEqual(
    expect.arrayContaining(['toolchain "cobol"', 'MCP "inventado"']),
  );
  expect(env.config.mcps).not.toContain('inventado');
});

test('build sem recipe: recipeWarnings vazio, sem extra', async () => {
  const env = await new EnvironmentBuilder(undefined, fakeGateway('present')).build('dba');
  expect(env.recipeWarnings).toEqual([]);
  expect(env.config.extra).toBeUndefined();
});

const PERFIS: Profile[] = ['fullstack', 'analyst', 'scientist', 'dba', 'qa', 'bi'];
const URL_VELHA = 'postgresql://u:p@192.168.0.250:5432/postgres';
const URL_NOVO = 'postgresql://u:p@192.168.0.142:5432/postgres';
const PG_URL_VARS = ['NIO_PG_VELHA_URL', 'NIO_PG_NOVO_URL'] as const;

/** Devolve a var ao valor anterior — `undefined` significa apagar, não setar `''`. */
function restaura(snapshot: Record<string, string | undefined>): void {
  for (const [key, valor] of Object.entries(snapshot)) {
    if (valor === undefined) delete process.env[key];
    else process.env[key] = valor;
  }
}

/**
 * Roda `fn` com as URLs dos Postgres de infra presentes (`urls`) ou ausentes, e
 * **restaura** o env depois. Sem isto a mutação vaza pros outros arquivos da
 * suíte — `bun test` compartilha o processo entre eles.
 */
async function comEnvDePg(urls: string[] | null, fn: () => Promise<void>): Promise<void> {
  const antes = Object.fromEntries(PG_URL_VARS.map((k) => [k, process.env[k]]));
  PG_URL_VARS.forEach((key, i) => {
    if (urls) process.env[key] = urls[i];
    else delete process.env[key];
  });
  try {
    await fn();
  } finally {
    restaura(antes);
  }
}

test('build: os MCPs de infra entram em TODOS os 6 perfis', async () => {
  const esperados = ['postgres-velha', 'postgres-novo', 'dax-staff-local', 'bi-gateway-portainer'];
  await comEnvDePg([URL_VELHA, URL_NOVO], async () => {
    for (const perfil of PERFIS) {
      // Gateway fake: o foco é a composição dos MCPs, não instalar toolchain de verdade.
      const env = await new EnvironmentBuilder(undefined, fakeGateway('present')).build(perfil);
      for (const id of esperados) {
        expect(
          env.mcps.some((m) => m.id === id),
          `${perfil} perdeu ${id}`,
        ).toBe(true);
        expect(env.config.mcps, `${perfil} não persistiu ${id}`).toContain(id);
      }
    }
  });
});

test('build: sem a env var da URL, os Postgres de infra ficam fora (os remotos ficam)', async () => {
  await comEnvDePg(null, async () => {
    const env = await new EnvironmentBuilder(undefined, fakeGateway('present')).build('qa');
    expect(env.mcps.some((m) => m.id === 'postgres-velha')).toBe(false);
    expect(env.mcps.some((m) => m.id === 'dax-staff-local')).toBe(true);
  });
});
