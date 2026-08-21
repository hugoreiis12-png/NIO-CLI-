import { test, expect, afterEach } from 'bun:test';
import { getPool, ping, closePool } from './client.js';

const KEY = 'NIO_DATABASE_URL';
const original = process.env[KEY];

afterEach(async () => {
  await closePool();
  if (original === undefined) delete process.env[KEY];
  else process.env[KEY] = original;
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
