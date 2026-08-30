import { test, expect } from 'bun:test';
import { definition as listDef, runSessionList } from './session-list.js';
import { definition as activateDef, runSessionActivate } from './session-activate.js';
import { definition as createDef, runSessionCreate } from './session-create.js';
import { SessionManager, SessionNotFoundError, AmbiguousSessionError } from '../app/session-manager.js';
import type { MaterializedSession } from '../app/session-manager.js';
import type { Session } from '../core/types.js';

function mkSession(over: Partial<Session> = {}): Session {
  return {
    id: 'aaaa1111-0000-0000-0000-000000000000',
    userId: 1,
    name: 'sess',
    profile: 'dba',
    status: 'active',
    projectPath: '/x',
    ide: 'vscode',
    config: { mcps: ['nio-lang'] },
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    ...over,
  };
}

const textOf = (r: { content: Array<{ text?: string }> }) => r.content[0]?.text ?? '';
const fakeManager = (over: Partial<SessionManager>) => over as unknown as SessionManager;

test('definitions: nomes prefixados e schema fechado', () => {
  expect(listDef.name).toBe('nio_session_list');
  expect(activateDef.name).toBe('nio_session_activate');
  expect(activateDef.inputSchema.required).toContain('id');
  expect(createDef.name).toBe('nio_session_create');
  expect(createDef.inputSchema.required).toEqual(expect.arrayContaining(['name', 'profile', 'project_path']));
});

test('session_list: devolve count + sessões serializadas (datas ISO)', async () => {
  const m = fakeManager({ list: async () => [mkSession(), mkSession({ id: 'b', status: 'paused' })] });
  const r = await runSessionList(m, 1);
  expect(r.isError).toBeFalsy();
  const out = JSON.parse(textOf(r));
  expect(out.count).toBe(2);
  expect(out.sessions[0].created_at).toBe('2026-01-01T00:00:00.000Z');
  expect(out.sessions[0].project_path).toBe('/x');
});

test('session_list: falha de banco → errorResult amigável', async () => {
  const m = fakeManager({
    list: async () => {
      throw new Error('connection refused');
    },
  });
  const r = await runSessionList(m, 1);
  expect(r.isError).toBe(true);
  expect(textOf(r)).toMatch(/Falha ao acessar as sessões/);
});

test('session_activate: sucesso → sessão ativada', async () => {
  const m = fakeManager({ activate: async () => mkSession({ status: 'active' }) });
  const r = await runSessionActivate(m, 1, 'aaaa');
  expect(r.isError).toBeFalsy();
  expect(JSON.parse(textOf(r)).activated.status).toBe('active');
});

test('session_activate: não encontrada → mensagem direta do erro', async () => {
  const m = fakeManager({
    activate: async () => {
      throw new SessionNotFoundError('zzz');
    },
  });
  const r = await runSessionActivate(m, 1, 'zzz');
  expect(r.isError).toBe(true);
  expect(textOf(r)).toMatch(/Nenhuma sessão começa com "zzz"/);
});

test('session_activate: prefixo ambíguo → mensagem direta do erro', async () => {
  const m = fakeManager({
    activate: async () => {
      throw new AmbiguousSessionError('ab', 3);
    },
  });
  const r = await runSessionActivate(m, 1, 'ab');
  expect(r.isError).toBe(true);
  expect(textOf(r)).toMatch(/Ambíguo: 3 sessões/);
});

test('session_create: sucesso → sessão + mcps + nota sobre opencode.json', async () => {
  const built: MaterializedSession = {
    session: mkSession(),
    config: { mcps: ['nio-lang', 'postgres'] },
    mcps: [
      { id: 'nio-lang', command: ['nio-lang'] },
      { id: 'postgres', command: ['x'] },
    ],
    toolchains: [{ id: 'postgresql-client', status: 'failed', error: 'sem plano' }],
    recipeWarnings: ['MCP "xyz"'],
  };
  const m = fakeManager({ create: async () => built });
  const r = await runSessionCreate(m, 7, { name: 'nova', profile: 'dba', projectPath: '/p', ide: 'vscode' });
  const out = JSON.parse(textOf(r));
  expect(out.mcps.map((x: { id: string }) => x.id)).toEqual(['nio-lang', 'postgres']);
  expect(out.toolchains_failed).toEqual([{ id: 'postgresql-client', error: 'sem plano' }]);
  expect(out.recipe_warnings).toEqual(['MCP "xyz"']);
  expect(out.materialize_error).toBeNull();
  expect(out.note).toMatch(/opencode\.json/);
});

test('session_create: materialização falha → materialize_error preenchido, sem lançar', async () => {
  const built: MaterializedSession = {
    session: mkSession(),
    config: {},
    mcps: [],
    toolchains: [],
    recipeWarnings: [],
    materializeError: 'perfil sem definição',
  };
  const m = fakeManager({ create: async () => built });
  const r = await runSessionCreate(m, 7, { name: 'x', profile: 'dba', projectPath: '/p', ide: 'other' });
  expect(r.isError).toBeFalsy();
  expect(JSON.parse(textOf(r)).materialize_error).toBe('perfil sem definição');
});

test('session_create: erro de banco → errorResult com contexto', async () => {
  const m = fakeManager({
    create: async () => {
      throw new Error('timeout');
    },
  });
  const r = await runSessionCreate(m, 7, { name: 'x', profile: 'dba', projectPath: '/p', ide: 'other' });
  expect(r.isError).toBe(true);
  expect(textOf(r)).toMatch(/Falha ao criar a sessão: timeout/);
});
