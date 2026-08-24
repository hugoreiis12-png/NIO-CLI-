import { describe, expect, test } from 'bun:test';
import { mapAuthSessionRow, type AuthSessionRow } from './auth-session-repository.js';

function row(overrides: Partial<AuthSessionRow> = {}): AuthSessionRow {
  return {
    id: 'a1b2c3d4-0000-4000-8000-000000000099',
    user_id: '7',
    expires_at: new Date('2026-08-23T22:00:00Z'),
    revoked_at: null,
    created_at: new Date('2026-08-23T10:00:00Z'),
    ...overrides,
  };
}

describe('mapAuthSessionRow', () => {
  test('mapeia snake_case → camelCase', () => {
    const s = mapAuthSessionRow(row());
    expect(s.id).toBe('a1b2c3d4-0000-4000-8000-000000000099');
    expect(s.userId).toBe(7);
    expect(s.expiresAt).toEqual(new Date('2026-08-23T22:00:00Z'));
    expect(s.revokedAt).toBeNull();
    expect(s.createdAt).toEqual(new Date('2026-08-23T10:00:00Z'));
  });

  test('user_id BIGINT string vira number', () => {
    expect(mapAuthSessionRow(row({ user_id: '42' })).userId).toBe(42);
  });

  test('revoked_at preenchido passa direto', () => {
    const revokedAt = new Date('2026-08-23T12:00:00Z');
    expect(mapAuthSessionRow(row({ revoked_at: revokedAt })).revokedAt).toEqual(revokedAt);
  });
});
