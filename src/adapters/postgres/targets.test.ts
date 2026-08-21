import { test, expect, beforeEach, afterEach } from 'bun:test';
import { resolveDsn, resolveUsersDsn, DB_TARGETS } from './targets.js';

const ENV_KEYS = ['NIO_DB_PRIMARY_URL', 'NIO_DB_SECONDARY_URL', 'NIO_DB_USERS_URL'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

test('mapa de destinos: primary=novo/142, secondary=antigo/250, porta 5432', () => {
  expect(DB_TARGETS.primary.host).toBe('192.168.0.142');
  expect(DB_TARGETS.secondary.host).toBe('192.168.0.250');
  expect(DB_TARGETS.primary.port).toBe(5432);
  expect(DB_TARGETS.secondary.port).toBe(5432);
});

test('resolveDsn: devolve o DSN do env do destino pedido', () => {
  process.env.NIO_DB_PRIMARY_URL = 'postgres://u:p@192.168.0.142:5432/novo';
  process.env.NIO_DB_SECONDARY_URL = 'postgres://u:p@192.168.0.250:5432/antigo';
  expect(resolveDsn('primary')).toBe('postgres://u:p@192.168.0.142:5432/novo');
  expect(resolveDsn('secondary')).toBe('postgres://u:p@192.168.0.250:5432/antigo');
});

test('resolveDsn: destino ausente → erro explícito (nunca default silencioso)', () => {
  expect(() => resolveDsn('primary')).toThrow('NIO_DB_PRIMARY_URL');
});

test('resolveDsn: um destino configurado não vaza para o outro', () => {
  process.env.NIO_DB_PRIMARY_URL = 'postgres://u:p@192.168.0.142:5432/novo';
  expect(() => resolveDsn('secondary')).toThrow('banco antigo');
});

test('resolveUsersDsn: lê NIO_DB_USERS_URL, erra se ausente', () => {
  expect(() => resolveUsersDsn()).toThrow('NIO_DB_USERS_URL');
  process.env.NIO_DB_USERS_URL = 'postgres://u:p@192.168.0.142:5432/nio_users';
  expect(resolveUsersDsn()).toBe('postgres://u:p@192.168.0.142:5432/nio_users');
});
