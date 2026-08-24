import { describe, expect, test } from 'bun:test';
import { expiresInMs } from './login.js';

// Fluxo completo (login → JWT → authenticate → logout, com banco) verificado
// manualmente via smoke script — mesmo padrão de pkce.test.ts/sessions.test.ts
// (spec 0002): só a lógica pura entra no `bun test`.

describe('expiresInMs', () => {
  test('segundos', () => {
    expect(expiresInMs('30s')).toBe(30_000);
  });

  test('minutos', () => {
    expect(expiresInMs('30m')).toBe(30 * 60_000);
  });

  test('horas', () => {
    expect(expiresInMs('12h')).toBe(12 * 3_600_000);
  });

  test('dias', () => {
    expect(expiresInMs('1d')).toBe(86_400_000);
  });

  test('aceita espaços nas pontas', () => {
    expect(expiresInMs('  12h  ')).toBe(12 * 3_600_000);
  });

  test('throw em formato sem unidade', () => {
    expect(() => expiresInMs('12')).toThrow('JWT_EXPIRES_IN inválido');
  });

  test('throw em unidade desconhecida', () => {
    expect(() => expiresInMs('12x')).toThrow('JWT_EXPIRES_IN inválido');
  });

  test('throw em string vazia', () => {
    expect(() => expiresInMs('')).toThrow('JWT_EXPIRES_IN inválido');
  });

  test('throw em número negativo (regex não casa o sinal)', () => {
    expect(() => expiresInMs('-12h')).toThrow('JWT_EXPIRES_IN inválido');
  });
});
