import { test, expect } from 'bun:test';
import { hashPassword, verifyPassword } from './password.js';

test('hashPassword gera uma PHC string argon2id', async () => {
  const h = await hashPassword('correct horse battery staple');
  expect(h.startsWith('$argon2id$')).toBe(true);
});

test('verifyPassword confere a senha certa e recusa a errada', async () => {
  const h = await hashPassword('senha-secreta');
  expect(await verifyPassword(h, 'senha-secreta')).toBe(true);
  expect(await verifyPassword(h, 'senha-errada')).toBe(false);
});

test('hashes da mesma senha diferem (salt aleatório)', async () => {
  const a = await hashPassword('igual');
  const b = await hashPassword('igual');
  expect(a).not.toBe(b);
});

test('verifyPassword retorna false (não lança) em hash inválido', async () => {
  expect(await verifyPassword('não-é-um-hash', 'x')).toBe(false);
});

test('hashPassword rejeita senha vazia', async () => {
  await expect(hashPassword('')).rejects.toThrow(/vazia/);
});
