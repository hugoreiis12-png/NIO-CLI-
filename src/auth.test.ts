import { test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCredentials, resolveIdentity, type Credentials } from './auth.js';

const USER = { id: 'u1', email: 'a@b.c', full_name: 'A B', username: 'ab' };

let dir: string;
let file: string;
let calls: number;
const realFetch = globalThis.fetch;

function stubExchange(status = 200) {
  globalThis.fetch = (async () => {
    calls++;
    return new Response(JSON.stringify(status === 200 ? { user: USER } : { error: 'nope' }), {
      status,
    });
  }) as typeof fetch;
}

function write(creds: Credentials) {
  writeFileSync(file, JSON.stringify(creds));
}

function read(): Credentials {
  return JSON.parse(readFileSync(file, 'utf8')) as Credentials;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nio-auth-'));
  file = join(dir, 'credentials.json');
  calls = 0;
  delete process.env.NIO_PAT;
  stubExchange();
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  globalThis.fetch = realFetch;
  delete process.env.NIO_PAT;
});

test('credencial legada só-pat carrega e popula o cache na primeira troca', async () => {
  write({ pat: 'nio_x' });
  const creds = await loadCredentials(file);
  expect(creds).toEqual({ pat: 'nio_x' });

  const id = await resolveIdentity(creds!, { file });
  expect(id.email).toBe(USER.email);
  expect(calls).toBe(1);
  expect(read().user).toEqual(USER);
  expect(typeof read().fetched_at).toBe('string');
});

test('cache presente → sem troca de PAT (funciona offline)', async () => {
  const cached: Credentials = { pat: 'nio_x', user: USER, fetched_at: '2026-01-01T00:00:00.000Z' };
  write(cached);

  const id = await resolveIdentity((await loadCredentials(file))!, { file });
  expect(calls).toBe(0);
  expect(id).toEqual({ ...USER, fetched_at: cached.fetched_at! });
});

test('contrato do --json: chaves estáveis', async () => {
  write({ pat: 'nio_x', user: USER, fetched_at: '2026-01-01T00:00:00.000Z' });
  const id = await resolveIdentity((await loadCredentials(file))!, { file });
  expect(Object.keys(id).sort()).toEqual([
    'email',
    'fetched_at',
    'full_name',
    'id',
    'username',
  ]);
});

test('--refresh refaz a troca e regrava o arquivo', async () => {
  write({ pat: 'nio_x', user: USER, fetched_at: '2026-01-01T00:00:00.000Z' });
  const id = await resolveIdentity((await loadCredentials(file))!, { file, refresh: true });
  expect(calls).toBe(1);
  expect(id.fetched_at).not.toBe('2026-01-01T00:00:00.000Z');
  expect(read().fetched_at).toBe(id.fetched_at);
});

test('401 invalida o cache e propaga', async () => {
  write({ pat: 'nio_x', user: USER, fetched_at: '2026-01-01T00:00:00.000Z' });
  stubExchange(401);

  const creds = (await loadCredentials(file))!;
  await expect(resolveIdentity(creds, { file, refresh: true })).rejects.toThrow();
  expect(read().user).toBeUndefined();
  expect(read().fetched_at).toBeUndefined();
});

test('NIO_PAT vence o arquivo; sem cache do mesmo PAT faz uma troca', async () => {
  write({ pat: 'nio_arquivo', user: USER, fetched_at: '2026-01-01T00:00:00.000Z' });
  process.env.NIO_PAT = 'nio_env';

  const creds = (await loadCredentials(file))!;
  expect(creds).toEqual({ pat: 'nio_env' });
  await resolveIdentity(creds, { file });
  expect(calls).toBe(1);
});

test('NIO_PAT sem arquivo de credencial: resolve sem persistir', async () => {
  process.env.NIO_PAT = 'nio_env';
  const creds = (await loadCredentials(file))!;
  const id = await resolveIdentity(creds, { file });
  expect(id.email).toBe(USER.email);
  expect(() => readFileSync(file, 'utf8')).toThrow();
});
