import { describe, expect, test } from 'bun:test';
import { extractBearerToken } from './auth.js';

// `authenticate()` (JWT + auth_session no banco) foi verificado manualmente
// via smoke script — mesmo padrão de pkce.test.ts/sessions.test.ts (spec
// 0002): só a lógica pura entra no `bun test`.

describe('extractBearerToken', () => {
  test('extrai o token de um header Bearer válido', () => {
    expect(extractBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  test('aceita "bearer" minúsculo (case-insensitive)', () => {
    expect(extractBearerToken('bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  test('aceita espaços nas pontas do header', () => {
    expect(extractBearerToken('  Bearer abc.def.ghi  ')).toBe('abc.def.ghi');
  });

  test('null para header ausente (undefined)', () => {
    expect(extractBearerToken(undefined)).toBeNull();
  });

  test('null para header ausente (null)', () => {
    expect(extractBearerToken(null)).toBeNull();
  });

  test('null para string vazia', () => {
    expect(extractBearerToken('')).toBeNull();
  });

  test('null sem o prefixo Bearer', () => {
    expect(extractBearerToken('abc.def.ghi')).toBeNull();
  });

  test('null para esquema diferente (Basic)', () => {
    expect(extractBearerToken('Basic dXNlcjpwYXNz')).toBeNull();
  });

  test('null para "Bearer" sem token depois', () => {
    expect(extractBearerToken('Bearer')).toBeNull();
    expect(extractBearerToken('Bearer ')).toBeNull();
  });
});
