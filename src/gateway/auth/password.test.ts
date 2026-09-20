import { test, expect, afterEach } from 'bun:test';
import {
  hashPassword,
  verifyPassword,
  needsRehash,
  currentArgon2Options,
} from './password.js';
import { __resetPeppers } from './secrets.js';

const ARGON_KEYS = ['NIO_ARGON2_MEMORY_MIB', 'NIO_ARGON2_TIME', 'NIO_ARGON2_PARALLELISM', 'NIO_PEPPERS', 'NIO_PEPPER'];
const orig = Object.fromEntries(ARGON_KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of ARGON_KEYS) {
    if (orig[k] === undefined) delete process.env[k];
    else process.env[k] = orig[k]!;
  }
  __resetPeppers();
});

test('hashPassword devolve { phc, pepperId } — PHC argon2id, pepperId 0 sem pepper', async () => {
  for (const k of ARGON_KEYS) delete process.env[k];
  __resetPeppers();
  const h = await hashPassword('correct horse battery staple');
  expect(h.phc.startsWith('$argon2id$')).toBe(true);
  expect(h.pepperId).toBe(0);
});

test('verifyPassword confere a senha certa e recusa a errada (sem pepper)', async () => {
  const h = await hashPassword('senha-secreta');
  expect(await verifyPassword(h.phc, 'senha-secreta', h.pepperId)).toBe(true);
  expect(await verifyPassword(h.phc, 'senha-errada', h.pepperId)).toBe(false);
});

test('pepper: hash com pepper só verifica com o mesmo pepperId', async () => {
  const strong = 'pepper-forte-de-32-ou-mais-caracteres-aqui';
  process.env.NIO_PEPPERS = `1:${strong}`;
  __resetPeppers();
  const h = await hashPassword('minha-senha');
  expect(h.pepperId).toBe(1);
  expect(await verifyPassword(h.phc, 'minha-senha', 1)).toBe(true);
  expect(await verifyPassword(h.phc, 'minha-senha', 0)).toBe(false); // sem o pepper → falha
});

test('hashes da mesma senha diferem (salt aleatório)', async () => {
  const a = await hashPassword('igual');
  const b = await hashPassword('igual');
  expect(a.phc).not.toBe(b.phc);
});

test('verifyPassword retorna false (não lança) em hash inválido', async () => {
  expect(await verifyPassword('não-é-um-hash', 'x', 0)).toBe(false);
});

test('hashPassword rejeita senha vazia', async () => {
  await expect(hashPassword('')).rejects.toThrow(/vazia/);
});

test('currentArgon2Options: default OWASP, override por env', () => {
  for (const k of ARGON_KEYS) delete process.env[k];
  expect(currentArgon2Options()).toMatchObject({ memoryCost: 19 * 1024, timeCost: 2, parallelism: 1 });
  process.env.NIO_ARGON2_MEMORY_MIB = '64';
  process.env.NIO_ARGON2_TIME = '3';
  expect(currentArgon2Options()).toMatchObject({ memoryCost: 64 * 1024, timeCost: 3 });
});

test('needsRehash: true quando os params mudam', async () => {
  for (const k of ARGON_KEYS) delete process.env[k];
  __resetPeppers();
  const h = await hashPassword('x');
  expect(needsRehash(h.phc, h.pepperId)).toBe(false);
  process.env.NIO_ARGON2_MEMORY_MIB = '64';
  expect(needsRehash(h.phc, h.pepperId)).toBe(true);
});

test('needsRehash: true quando o pepper fica desatualizado', async () => {
  for (const k of ARGON_KEYS) delete process.env[k];
  __resetPeppers();
  const h = await hashPassword('x'); // pepperId 0
  process.env.NIO_PEPPERS = '1:pepper-forte-de-32-ou-mais-caracteres-aqui';
  __resetPeppers();
  expect(needsRehash(h.phc, 0)).toBe(true);
});

test('needsRehash: formato estranho → true', () => {
  expect(needsRehash('lixo', 0)).toBe(true);
});
