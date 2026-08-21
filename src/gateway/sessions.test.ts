import { test, expect } from 'bun:test';
import { createSession, validateSession, revokeSession, activeSessionCount } from './sessions.js';
import type { GatewayUser } from './types.js';

function user(id: string): GatewayUser {
  return { id, email: `${id}@example.com` };
}

test('createSession: token válido resolve o mesmo usuário em validateSession', () => {
  const u = user('u1');
  const { token, expiresIn } = createSession(u);
  expect(expiresIn).toBeGreaterThan(0);
  expect(validateSession(token)).toEqual(u);
});

test('createSession: novo login do mesmo usuário invalida o token anterior', () => {
  const u = user('u2');
  const { token: first } = createSession(u);
  const { token: second } = createSession(u);
  expect(validateSession(first)).toBeNull();
  expect(validateSession(second)).toEqual(u);
});

test('validateSession: token desconhecido devolve null', () => {
  expect(validateSession('token-que-nao-existe')).toBeNull();
});

test('revokeSession: derruba a sessão; segunda chamada devolve false', () => {
  const { token } = createSession(user('u3'));
  expect(revokeSession(token)).toBe(true);
  expect(validateSession(token)).toBeNull();
  expect(revokeSession(token)).toBe(false);
});

test('activeSessionCount: reflete sessões vivas após revoke', () => {
  const before = activeSessionCount();
  const { token } = createSession(user('u4'));
  expect(activeSessionCount()).toBe(before + 1);
  revokeSession(token);
  expect(activeSessionCount()).toBe(before);
});
