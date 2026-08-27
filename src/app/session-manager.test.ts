import { test, expect } from 'bun:test';
import {
  SessionManager,
  SessionNotFoundError,
  AmbiguousSessionError,
  matchByIdPrefix,
} from './session-manager.js';
import type { EnvironmentBuilder } from './environment-builder.js';
import type { SessionRepository, NewSessionInput } from '../core/repositories.js';
import type { Session, EnvironmentConfig } from '../core/session.js';

function mkSession(over: Partial<Session> = {}): Session {
  return {
    id: 'aaaaaaaa-0000-0000-0000-000000000000',
    userId: 1,
    name: 'sess',
    profile: 'dba',
    status: 'active',
    projectPath: '/x',
    ide: 'other',
    config: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

/** Repo fake em memória — só o suficiente pro SessionManager. */
function fakeRepo(seed: Session[] = []): SessionRepository & { rows: Session[] } {
  const rows = [...seed];
  return {
    rows,
    async create(input: NewSessionInput) {
      for (const r of rows) if (r.userId === input.userId && r.status === 'active') r.status = 'archived';
      const s = mkSession({
        id: `id-${rows.length}`,
        userId: input.userId,
        name: input.name,
        profile: input.profile,
        projectPath: input.projectPath,
        ide: input.ide,
        config: input.config ?? {},
      });
      rows.push(s);
      return s;
    },
    async findById(id) {
      return rows.find((r) => r.id === id) ?? null;
    },
    async listByUser(userId) {
      return rows.filter((r) => r.userId === userId);
    },
    async findActiveByUser(userId) {
      return rows.find((r) => r.userId === userId && r.status === 'active') ?? null;
    },
    async activate(id, userId) {
      const target = rows.find((r) => r.id === id);
      if (!target) return null;
      for (const r of rows) if (r.userId === userId && r.status === 'active') r.status = 'archived';
      target.status = 'active';
      return target;
    },
    async setStatus(id, status) {
      const r = rows.find((x) => x.id === id);
      if (r) r.status = status;
    },
    async updateConfig(id, config) {
      const r = rows.find((x) => x.id === id);
      if (r) r.config = config;
    },
    async delete(id) {
      const i = rows.findIndex((r) => r.id === id);
      if (i >= 0) rows.splice(i, 1);
    },
  };
}

const FAKE_CONFIG: EnvironmentConfig = { languages: ['sql'], mcps: ['nio-lang', 'postgres'] };

/**
 * Builder fake — devolve sempre o mesmo ambiente, ou lança se `fail`. Registra
 * o último `recipe` recebido pra os testes de threading conferirem.
 */
function fakeBuilder(fail?: string): EnvironmentBuilder & { lastRecipe?: unknown } {
  const b: { build: unknown; lastRecipe?: unknown } = {
    build: async (_profile: unknown, recipe?: unknown) => {
      b.lastRecipe = recipe;
      if (fail) throw new Error(fail);
      return {
        config: recipe ? { ...FAKE_CONFIG, extra: { recipe: (recipe as { slug: string }).slug } } : FAKE_CONFIG,
        mcps: [
          { id: 'nio-lang', command: ['nio-lang'] },
          { id: 'postgres', command: ['x'] },
        ],
        toolchains: [{ id: 'postgresql-client', status: 'present' as const }],
        recipeWarnings: [],
      };
    },
  };
  return b as unknown as EnvironmentBuilder & { lastRecipe?: unknown };
}

const RECIPE = {
  slug: 'dba-postgres',
  title: 'DBA Postgres',
  description: '',
  profile: 'dba' as const,
  languages: [],
  frameworks: [],
  toolchainIds: [],
  mcpIds: [],
  envVars: {},
  aliases: {},
  notes: '',
};

/** Catálogo de recipes fake — só o que `SessionManager.recipeFor` usa (`get`). */
function fakeRecipes(byslug: Record<string, typeof RECIPE> = {}) {
  return {
    list: () => Object.values(byslug),
    get: (slug: string) => byslug[slug] ?? null,
  } as unknown as import('../core/environment.js').RecipeCatalog;
}

test('matchByIdPrefix: filtra pelo prefixo do id', () => {
  const s = [mkSession({ id: 'abcd' }), mkSession({ id: 'abef' }), mkSession({ id: 'zzzz' })];
  expect(matchByIdPrefix(s, 'ab')).toHaveLength(2);
  expect(matchByIdPrefix(s, 'abcd')).toHaveLength(1);
  expect(matchByIdPrefix(s, 'nope')).toHaveLength(0);
});

test('resolve: um match devolve a sessão', async () => {
  const repo = fakeRepo([mkSession({ id: 'abcd1111' }), mkSession({ id: 'ef992222', status: 'paused' })]);
  const m = new SessionManager(repo, fakeBuilder());
  expect((await m.resolve(1, 'abcd')).id).toBe('abcd1111');
});

test('resolve: nenhum match lança SessionNotFoundError', async () => {
  const m = new SessionManager(fakeRepo([mkSession({ id: 'abcd' })]), fakeBuilder());
  await expect(m.resolve(1, 'zzz')).rejects.toBeInstanceOf(SessionNotFoundError);
});

test('resolve: prefixo ambíguo lança AmbiguousSessionError com a contagem', async () => {
  const repo = fakeRepo([mkSession({ id: 'ab01' }), mkSession({ id: 'ab02', status: 'paused' })]);
  const m = new SessionManager(repo, fakeBuilder());
  const err = await m.resolve(1, 'ab').catch((e) => e);
  expect(err).toBeInstanceOf(AmbiguousSessionError);
  expect((err as AmbiguousSessionError).count).toBe(2);
});

test('resolveOrActive: sem prefixo devolve a sessão ativa', async () => {
  const repo = fakeRepo([mkSession({ id: 'p1', status: 'paused' }), mkSession({ id: 'a1', status: 'active' })]);
  const m = new SessionManager(repo, fakeBuilder());
  expect((await m.resolveOrActive(1)).id).toBe('a1');
});

test('resolveOrActive: sem ativa e sem prefixo lança SessionNotFoundError', async () => {
  const repo = fakeRepo([mkSession({ id: 'p1', status: 'paused' })]);
  const m = new SessionManager(repo, fakeBuilder());
  await expect(m.resolveOrActive(1)).rejects.toBeInstanceOf(SessionNotFoundError);
});

test('activate: ativa a alvo e arquiva a que estava ativa', async () => {
  const repo = fakeRepo([mkSession({ id: 'a1', status: 'active' }), mkSession({ id: 'b2', status: 'paused' })]);
  const m = new SessionManager(repo, fakeBuilder());
  const updated = await m.activate(1, 'b2');
  expect(updated.status).toBe('active');
  expect(repo.rows.find((r) => r.id === 'a1')?.status).toBe('archived');
});

test('create: cria a sessão e persiste o config materializado', async () => {
  const repo = fakeRepo();
  const m = new SessionManager(repo, fakeBuilder());
  const built = await m.create({ userId: 7, name: 'nova', profile: 'dba', projectPath: '/p', ide: 'vscode' });
  expect(built.session.config).toEqual(FAKE_CONFIG);
  expect(built.mcps.map((x) => x.id)).toEqual(['nio-lang', 'postgres']);
  expect(built.materializeError).toBeUndefined();
  expect(repo.rows[0]?.config).toEqual(FAKE_CONFIG);
});

test('create: materialização falha → sessão preservada + materializeError', async () => {
  const repo = fakeRepo();
  const m = new SessionManager(repo, fakeBuilder('perfil sem definição'));
  const built = await m.create({ userId: 7, name: 'nova', profile: 'dba', projectPath: '/p', ide: 'vscode' });
  expect(built.materializeError).toBe('perfil sem definição');
  expect(repo.rows).toHaveLength(1); // não perdeu a sessão
  expect(built.mcps).toEqual([]);
});

test('materialize: re-roda o builder na sessão ativa e persiste', async () => {
  const repo = fakeRepo([mkSession({ id: 'a1', status: 'active', config: {} })]);
  const m = new SessionManager(repo, fakeBuilder());
  const out = await m.materialize(1);
  expect(out.config).toEqual(FAKE_CONFIG);
  expect(repo.rows[0]?.config).toEqual(FAKE_CONFIG);
});

test('materialize: falha do builder propaga (a sessão já existe)', async () => {
  const repo = fakeRepo([mkSession({ id: 'a1', status: 'active' })]);
  const m = new SessionManager(repo, fakeBuilder('boom'));
  await expect(m.materialize(1)).rejects.toThrow('boom');
});

test('create: recipe é passada pro builder e o slug entra em config.extra', async () => {
  const repo = fakeRepo();
  const builder = fakeBuilder();
  const m = new SessionManager(repo, builder, fakeRecipes());
  const built = await m.create({
    userId: 7, name: 'x', profile: 'dba', projectPath: '/p', ide: 'other', recipe: RECIPE,
  });
  expect(builder.lastRecipe).toBe(RECIPE);
  expect(built.config.extra).toEqual({ recipe: 'dba-postgres' });
  expect(repo.rows[0]?.config.extra).toEqual({ recipe: 'dba-postgres' });
});

test('materialize: relê config.extra.recipe do catálogo e reaplica', async () => {
  const repo = fakeRepo([
    mkSession({ id: 'a1', status: 'active', config: { extra: { recipe: 'dba-postgres' } } }),
  ]);
  const builder = fakeBuilder();
  const m = new SessionManager(repo, builder, fakeRecipes({ 'dba-postgres': RECIPE }));
  await m.materialize(1);
  expect(builder.lastRecipe).toBe(RECIPE);
});

test('materialize: recipe do config sumiu do catálogo → segue sem recipe (não quebra)', async () => {
  const repo = fakeRepo([
    mkSession({ id: 'a1', status: 'active', config: { extra: { recipe: 'apagada' } } }),
  ]);
  const builder = fakeBuilder();
  const m = new SessionManager(repo, builder, fakeRecipes());
  await m.materialize(1);
  expect(builder.lastRecipe).toBeUndefined();
});
