import { test, expect, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getPool, ping, closePool, isUuid, readSslOption } from './client.js';

const KEY = 'NIO_DATABASE_URL';
const original = process.env[KEY];
const SSL_KEYS = ['NIO_DATABASE_SSL', 'NIO_DATABASE_SSL_INSECURE', 'NIO_DATABASE_CA'] as const;
const sslOriginal = Object.fromEntries(SSL_KEYS.map((k) => [k, process.env[k]]));

afterEach(async () => {
  await closePool();
  if (original === undefined) delete process.env[KEY];
  else process.env[KEY] = original;
  for (const k of SSL_KEYS) {
    if (sslOriginal[k] === undefined) delete process.env[k];
    else process.env[k] = sslOriginal[k]!;
  }
});

test('getPool lança quando NIO_DATABASE_URL não está definida', () => {
  delete process.env[KEY];
  expect(() => getPool()).toThrow(/NIO_DATABASE_URL não definida/);
});

test('getPool lança quando o esquema da URL é inválido', () => {
  process.env[KEY] = 'mysql://user:pass@host/db';
  expect(() => getPool()).toThrow(/inválida/);
});

test('ping retorna false (não lança) quando não há URL configurada', async () => {
  delete process.env[KEY];
  expect(await ping()).toBe(false);
});

test('getPool é singleton com uma URL válida', () => {
  // URL bem-formada não conecta na hora (connect é lazy na 1ª query), então
  // isto não toca a rede — só valida a construção e o caching do pool.
  process.env[KEY] = 'postgres://user:pass@localhost:5432/nio_cli';
  expect(getPool()).toBe(getPool());
});

// --- H-2: TLS do Postgres com verificação de certificado ---

const REMOTE_URL = 'postgres://user:pass@db.example.com:5432/nio_cli';
const LOOPBACK_URL = 'postgres://user:pass@localhost:5432/nio_cli';

test('readSslOption: default (sem flag) → TLS ligado com verificação em host remoto', () => {
  for (const k of SSL_KEYS) delete process.env[k];
  expect(readSslOption(REMOTE_URL)).toEqual({ rejectUnauthorized: true });
});

test('readSslOption: default (sem flag) → sem TLS em banco loopback (dev local)', () => {
  for (const k of SSL_KEYS) delete process.env[k];
  expect(readSslOption(LOOPBACK_URL)).toBeUndefined();
  expect(readSslOption('postgres://user:pass@127.0.0.1:5432/nio_cli')).toBeUndefined();
});

test('readSslOption: NIO_DATABASE_SSL=false → opt-out explícito mesmo em host remoto', () => {
  for (const k of SSL_KEYS) delete process.env[k];
  process.env.NIO_DATABASE_SSL = 'false';
  expect(readSslOption(REMOTE_URL)).toBeUndefined();
});

test('readSslOption: NIO_DATABASE_SSL=true → força TLS mesmo em loopback', () => {
  for (const k of SSL_KEYS) delete process.env[k];
  process.env.NIO_DATABASE_SSL = 'true';
  expect(readSslOption(LOOPBACK_URL)).toEqual({ rejectUnauthorized: true });
});

test('readSslOption: NIO_DATABASE_CA → carrega o PEM e mantém a verificação', () => {
  for (const k of SSL_KEYS) delete process.env[k];
  const dir = mkdtempSync(join(tmpdir(), 'nio-ca-'));
  const caPath = join(dir, 'ca.pem');
  writeFileSync(caPath, '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----\n');
  process.env.NIO_DATABASE_SSL = '1';
  process.env.NIO_DATABASE_CA = caPath;
  expect(readSslOption(REMOTE_URL)).toEqual({
    rejectUnauthorized: true,
    ca: '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----\n',
  });
});

test('readSslOption: NIO_DATABASE_CA ilegível → lança', () => {
  for (const k of SSL_KEYS) delete process.env[k];
  process.env.NIO_DATABASE_SSL = 'true';
  process.env.NIO_DATABASE_CA = join(tmpdir(), 'nao-existe-' + Date.now() + '.pem');
  expect(() => readSslOption(REMOTE_URL)).toThrow(/NIO_DATABASE_CA/);
});

test('readSslOption: NIO_DATABASE_SSL_INSECURE=1 → desliga a verificação (opt-in explícito)', () => {
  for (const k of SSL_KEYS) delete process.env[k];
  process.env.NIO_DATABASE_SSL = 'true';
  process.env.NIO_DATABASE_SSL_INSECURE = '1';
  expect(readSslOption(REMOTE_URL)).toEqual({ rejectUnauthorized: false });
});

test('isUuid: aceita UUID (qualquer caixa), rejeita o resto', () => {
  expect(isUuid('36aa759f-3b92-4ae7-a490-cf8659d362d1')).toBe(true);
  expect(isUuid('36AA759F-3B92-4AE7-A490-CF8659D362D1')).toBe(true);
  expect(isUuid('x')).toBe(false);
  expect(isUuid('')).toBe(false);
  expect(isUuid('36aa759f-3b92-4ae7-a490-cf8659d362d1 ')).toBe(false);
});
