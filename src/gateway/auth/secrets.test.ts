import { test, expect, afterEach } from 'bun:test';
import jwt from 'jsonwebtoken';
import {
  __resetPeppers,
  __resetJwtSecrets,
  currentPepperId,
  pepperFor,
  otpHmacSecret,
  jwtSigningKey,
  jwtVerifyKey,
  NO_PEPPER,
} from './secrets.js';

const KEYS = ['NIO_PEPPERS', 'NIO_PEPPER', 'OTP_HMAC_SECRET', 'JWT_SECRET', 'JWT_SECRETS'];
const orig = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of KEYS) {
    if (orig[k] === undefined) delete process.env[k];
    else process.env[k] = orig[k]!;
  }
  __resetPeppers();
  __resetJwtSecrets();
});

const JWT_A = 'segredo-jwt-antigo-com-mais-de-32-caracteres';
const JWT_B = 'segredo-jwt-novo-com-mais-de-32-caracteres!!';

const S32 = 'x'.repeat(32); // segredo de teste com o tamanho mínimo

test('sem NIO_PEPPERS/NIO_PEPPER → currentPepperId 0, pepperFor(0) undefined', () => {
  delete process.env.NIO_PEPPERS;
  delete process.env.NIO_PEPPER;
  __resetPeppers();
  expect(currentPepperId()).toBe(NO_PEPPER);
  expect(pepperFor(0)).toBeUndefined();
  expect(pepperFor(1)).toBeUndefined();
});

test('NIO_PEPPER (singular) = id 1', () => {
  process.env.NIO_PEPPER = S32;
  __resetPeppers();
  expect(currentPepperId()).toBe(1);
  expect(pepperFor(1)?.toString('utf8')).toBe(S32);
});

test('NIO_PEPPERS: CSV id:segredo, o de maior id é o atual', () => {
  process.env.NIO_PEPPERS = `1:${S32},2:${'y'.repeat(40)}`;
  __resetPeppers();
  expect(currentPepperId()).toBe(2);
  expect(pepperFor(1)?.toString('utf8')).toBe(S32);
  expect(pepperFor(2)?.toString('utf8')).toBe('y'.repeat(40));
  expect(pepperFor(3)).toBeUndefined();
});

test('NIO_PEPPERS: segredo curto → lança', () => {
  process.env.NIO_PEPPERS = '1:curto';
  __resetPeppers();
  expect(() => currentPepperId()).toThrow(/mínimo/);
});

test('NIO_PEPPERS: entrada malformada → lança', () => {
  process.env.NIO_PEPPERS = 'sem-dois-pontos';
  __resetPeppers();
  expect(() => currentPepperId()).toThrow(/inválido/);
});

// ─── JWT rotação por kid (ADR 0011 §E) ─────────────────────────────

test('sem JWT_SECRETS: assina sem kid, verifica com JWT_SECRET', () => {
  delete process.env.JWT_SECRETS;
  process.env.JWT_SECRET = JWT_A;
  __resetJwtSecrets();
  const sk = jwtSigningKey();
  expect(sk.kid).toBeUndefined();
  expect(sk.secret).toBe(JWT_A);
  expect(jwtVerifyKey(undefined)).toBe(JWT_A);
  expect(jwtVerifyKey('qualquer')).toBeNull(); // kid não reconhecido
});

test('com JWT_SECRETS: a última entrada assina; qualquer uma verifica', () => {
  process.env.JWT_SECRETS = `2026a:${JWT_A},2026b:${JWT_B}`;
  process.env.JWT_SECRET = JWT_A;
  __resetJwtSecrets();
  const sk = jwtSigningKey();
  expect(sk.kid).toBe('2026b'); // a última
  expect(sk.secret).toBe(JWT_B);
  expect(jwtVerifyKey('2026a')).toBe(JWT_A);
  expect(jwtVerifyKey('2026b')).toBe(JWT_B);
  expect(jwtVerifyKey('2026c')).toBeNull();
  expect(jwtVerifyKey(undefined)).toBe(JWT_A); // token legado → JWT_SECRET
});

test('JWT_SECRETS malformado / kid inválido / segredo curto → lança', () => {
  __resetJwtSecrets();
  process.env.JWT_SECRETS = 'sem-dois-pontos';
  expect(() => jwtSigningKey()).toThrow(/inválido/);
  __resetJwtSecrets();
  process.env.JWT_SECRETS = `kid com espaço:${JWT_A}`;
  expect(() => jwtSigningKey()).toThrow(/kid/);
  __resetJwtSecrets();
  process.env.JWT_SECRETS = '2026a:curto';
  expect(() => jwtSigningKey()).toThrow(/mínimo/);
});

test('roundtrip: token assinado com kid é verificável pela chave resolvida', () => {
  process.env.JWT_SECRETS = `2026a:${JWT_A},2026b:${JWT_B}`;
  __resetJwtSecrets();
  const { kid, secret } = jwtSigningKey();
  const token = jwt.sign({ jti: 'x' }, secret, { algorithm: 'HS256', keyid: kid });

  const header = jwt.decode(token, { complete: true })?.header;
  expect(header?.kid).toBe('2026b');
  const verifyKey = jwtVerifyKey(header?.kid);
  expect(() => jwt.verify(token, verifyKey!, { algorithms: ['HS256'] })).not.toThrow();
  // chave errada → falha
  expect(() => jwt.verify(token, JWT_A, { algorithms: ['HS256'] })).toThrow();
});

test('otpHmacSecret: OTP_HMAC_SECRET quando setado, senão JWT_SECRET', () => {
  const jwt = 'x7K2p9Qw3mZ1aB5nR8tL4vE6cH0jY2sD'; // forte (passa jwtSecretWeakness)
  process.env.JWT_SECRET = jwt;
  delete process.env.OTP_HMAC_SECRET;
  expect(otpHmacSecret()).toBe(jwt);
  process.env.OTP_HMAC_SECRET = 'chave-do-otp-com-mais-de-32-caracteres!';
  expect(otpHmacSecret()).toBe('chave-do-otp-com-mais-de-32-caracteres!');
});
