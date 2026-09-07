import { test, expect, afterEach } from 'bun:test';
import {
  MIN_JWT_SECRET_LENGTH,
  generateJwtSecret,
  getJwtSecret,
  jwtSecretWeakness,
} from './config.js';

const original = process.env.JWT_SECRET;
afterEach(() => {
  if (original === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = original;
});

// --- H-1: força do JWT_SECRET ---

test('jwtSecretWeakness: curto demais → rejeita', () => {
  expect(jwtSecretWeakness('curto')).toMatch(/muito curto/);
  expect(jwtSecretWeakness('a'.repeat(MIN_JWT_SECRET_LENGTH - 1))).toMatch(/muito curto/);
});

test('jwtSecretWeakness: 32 chars mas repetitivo → rejeita (baixa entropia)', () => {
  expect(jwtSecretWeakness('a'.repeat(40))).toMatch(/variedade/);
  expect(jwtSecretWeakness('abababababababababababababababab')).toMatch(/variedade/);
});

test('jwtSecretWeakness: aleatório de 32+ chars → passa (null)', () => {
  expect(jwtSecretWeakness('x7K2p9Qw3mZ1aB5nR8tL4vE6cH0jY2sD')).toBeNull();
  expect(jwtSecretWeakness(generateJwtSecret())).toBeNull();
});

test('generateJwtSecret: forte e diferente a cada chamada', () => {
  const a = generateJwtSecret();
  const b = generateJwtSecret();
  expect(a).not.toBe(b);
  expect(a.length).toBeGreaterThanOrEqual(MIN_JWT_SECRET_LENGTH);
  expect(jwtSecretWeakness(a)).toBeNull();
});

test('getJwtSecret: ausente → lança pedindo `nio config setup`', () => {
  delete process.env.JWT_SECRET;
  expect(() => getJwtSecret()).toThrow(/JWT_SECRET não definida/);
});

test('getJwtSecret: fraco → lança (não deixa subir com segredo forjável)', () => {
  process.env.JWT_SECRET = 'segredo-curto';
  expect(() => getJwtSecret()).toThrow(/fraco/);
});

test('getJwtSecret: forte → devolve o valor (trim)', () => {
  const s = generateJwtSecret();
  process.env.JWT_SECRET = `  ${s}  `;
  expect(getJwtSecret()).toBe(s);
});
