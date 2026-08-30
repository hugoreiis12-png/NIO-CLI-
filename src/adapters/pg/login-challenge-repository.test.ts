import { test, expect } from 'bun:test';
import { mapLoginChallengeRow, type LoginChallengeRow } from './login-challenge-repository.js';

const row: LoginChallengeRow = {
  id: 'c1d2e3f4-0000-4000-8000-000000000001',
  user_id: '7',
  purpose: 'login',
  code_hash: 'deadbeef',
  channel: 'sms',
  attempts: 2,
  expires_at: new Date('2026-08-29T12:05:00Z'),
  consumed_at: null,
  created_at: new Date('2026-08-29T12:00:00Z'),
};

test('mapLoginChallengeRow: snake→camel, user_id string→number, tipos', () => {
  const c = mapLoginChallengeRow(row);
  expect(c.userId).toBe(7);
  expect(c.purpose).toBe('login');
  expect(c.channel).toBe('sms');
  expect(c.attempts).toBe(2);
  expect(c.consumedAt).toBeNull();
  expect(c.expiresAt).toEqual(new Date('2026-08-29T12:05:00Z'));
});

test('mapLoginChallengeRow: consumed_at preservado; purpose enable_2fa', () => {
  const c = mapLoginChallengeRow({
    ...row,
    purpose: 'enable_2fa',
    consumed_at: new Date('2026-08-29T12:02:00Z'),
  });
  expect(c.purpose).toBe('enable_2fa');
  expect(c.consumedAt).toEqual(new Date('2026-08-29T12:02:00Z'));
});
