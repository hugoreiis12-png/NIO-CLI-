import { test, expect } from 'bun:test';
import { definition as matDef, runEnvMaterialize } from './env-materialize.js';
import { definition as detDef, runEnvDetectDeps, type MakeWatcher } from './env-detect-deps.js';
import { SessionManager, SessionNotFoundError } from '../app/session-manager.js';
import type { MaterializedSession } from '../app/session-manager.js';
import type { DependencyWatcher, TickResult } from '../app/dependency-watcher.js';
import type { Session } from '../core/types.js';

function mkSession(over: Partial<Session> = {}): Session {
  return {
    id: 'aaaa1111-0000-0000-0000-000000000000',
    userId: 1,
    name: 'sess',
    profile: 'dba',
    status: 'active',
    projectPath: '/proj',
    ide: 'vscode',
    config: {},
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

const textOf = (r: { content: Array<{ text?: string }> }) => r.content[0]?.text ?? '';
const fakeManager = (over: Partial<SessionManager>) => over as unknown as SessionManager;

test('definitions: nomes prefixados e schema aberto (session opcional)', () => {
  expect(matDef.name).toBe('nio_env_materialize');
  expect(detDef.name).toBe('nio_env_detect_deps');
  expect(matDef.inputSchema.required).toEqual([]);
});

test('env_materialize: re-materializa a sessão e devolve config + toolchains falhos', async () => {
  const built: MaterializedSession = {
    session: mkSession(),
    config: { mcps: ['nio-lang', 'postgres'], toolchains: ['postgresql-client'] },
    mcps: [{ id: 'postgres', command: ['x'] }],
    toolchains: [
      { id: 'postgresql-client', status: 'present' },
      { id: 'node', status: 'failed', error: 'sem plano no Windows' },
    ],
    recipeWarnings: ['toolchain "cobol"'],
  };
  const m = fakeManager({ materialize: async () => built });
  const r = await runEnvMaterialize(m, 1);
  const out = JSON.parse(textOf(r));
  expect(out.recipe_warnings).toEqual(['toolchain "cobol"']);
  expect(out.config.toolchains).toContain('postgresql-client');
  expect(out.toolchains_failed).toEqual([{ id: 'node', error: 'sem plano no Windows' }]);
});

test('env_materialize: sem sessão ativa → mensagem direta', async () => {
  const m = fakeManager({
    materialize: async () => {
      throw new SessionNotFoundError('(sessão ativa)');
    },
  });
  const r = await runEnvMaterialize(m, 1);
  expect(r.isError).toBe(true);
  expect(textOf(r)).toMatch(/Nenhuma sessão começa com "\(sessão ativa\)"/);
});

test('env_materialize: erro do builder → errorResult com contexto', async () => {
  const m = fakeManager({
    materialize: async () => {
      throw new Error('psql travou');
    },
  });
  const r = await runEnvMaterialize(m, 1);
  expect(textOf(r)).toMatch(/Falha ao materializar o ambiente: psql travou/);
});

const tick = (over: Partial<TickResult> = {}): TickResult => ({
  scanned: 3,
  missing: [{ name: 'zod', type: 'npm', filePath: '/proj/package.json' }],
  recorded: [
    {
      id: 'e1',
      sessionId: 'aaaa1111-0000-0000-0000-000000000000',
      filePath: '/proj/package.json',
      dependencyName: 'zod',
      dependencyType: 'npm',
      detectedAt: new Date(),
      installed: false,
      installedAt: null,
    },
  ],
  installed: [],
  ...over,
});

function fakeWatcher(result: TickResult): DependencyWatcher {
  return { tick: async () => result } as unknown as DependencyWatcher;
}

test('env_detect_deps: um tick na sessão ativa → scanned/missing/recorded serializados', async () => {
  const m = fakeManager({ resolveOrActive: async () => mkSession() });
  let requestedInstall: boolean | undefined;
  const make: MakeWatcher = (autoInstall) => {
    requestedInstall = autoInstall;
    return fakeWatcher(tick());
  };
  const r = await runEnvDetectDeps(m, make, 1, {});
  const out = JSON.parse(textOf(r));
  expect(requestedInstall).toBe(false); // install default = false
  expect(out.session_id).toBe('aaaa1111-0000-0000-0000-000000000000');
  expect(out.missing[0]).toEqual({ name: 'zod', type: 'npm', file: '/proj/package.json' });
  expect(out.recorded[0]).toEqual({ name: 'zod', type: 'npm', file: '/proj/package.json' });
});

test('env_detect_deps: install:true propaga pro watcher', async () => {
  const m = fakeManager({ resolveOrActive: async () => mkSession() });
  let requestedInstall: boolean | undefined;
  const make: MakeWatcher = (autoInstall) => {
    requestedInstall = autoInstall;
    return fakeWatcher(tick({ installed: ['npm'] }));
  };
  const r = await runEnvDetectDeps(m, make, 1, { install: true });
  expect(requestedInstall).toBe(true);
  expect(JSON.parse(textOf(r)).installed).toEqual(['npm']);
});

test('env_detect_deps: sessão inexistente → mensagem direta, watcher nunca chamado', async () => {
  const m = fakeManager({
    resolveOrActive: async () => {
      throw new SessionNotFoundError('zz');
    },
  });
  let made = false;
  const make: MakeWatcher = () => {
    made = true;
    return fakeWatcher(tick());
  };
  const r = await runEnvDetectDeps(m, make, 1, { session: 'zz' });
  expect(r.isError).toBe(true);
  expect(made).toBe(false);
});
