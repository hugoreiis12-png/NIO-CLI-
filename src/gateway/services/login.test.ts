import { beforeAll, describe, expect, test } from 'bun:test';
import {
  expiresInMs,
  maskPhone,
  challengeUsable,
  login,
  verifyLogin,
  type LoginDeps,
} from './login.js';
import { hashOtp } from '../../lib/otp.js';
import type { UserCli, LoginChallenge } from '../../core/types.js';
import type { UserRepository, LoginChallengeRepository } from '../../core/repositories.js';
import type { SmsSender } from '../../core/messaging.js';

beforeAll(() => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-login';
});

// ─── expiresInMs (inalterado) ───────────────────────────────────────
describe('expiresInMs', () => {
  test('unidades + espaços', () => {
    expect(expiresInMs('30s')).toBe(30_000);
    expect(expiresInMs('12h')).toBe(12 * 3_600_000);
    expect(expiresInMs('  1d  ')).toBe(86_400_000);
  });
  test('throw em formato inválido', () => {
    expect(() => expiresInMs('12')).toThrow('JWT_EXPIRES_IN inválido');
    expect(() => expiresInMs('-12h')).toThrow();
    expect(() => expiresInMs('')).toThrow();
  });
});

// ─── maskPhone ──────────────────────────────────────────────────────
test('maskPhone: mantém DDI + últimos 4, nunca o número inteiro', () => {
  expect(maskPhone('+5511988887777')).toBe('+55•••••••7777');
  expect(maskPhone('+55 11 98888-7777')).toBe('+55•••••••7777');
  expect(maskPhone('+551234')).toBe('•••••••');
});

// ─── challengeUsable ────────────────────────────────────────────────
describe('challengeUsable', () => {
  const base: LoginChallenge = {
    id: 'c1',
    userId: 1,
    purpose: 'login',
    codeHash: 'h',
    channel: 'sms',
    attempts: 0,
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
    createdAt: new Date(),
  };
  test('null → not_found; consumido → consumed; expirado → expired; ok', () => {
    expect(challengeUsable(null)).toEqual({ ok: false, reason: 'not_found' });
    expect(challengeUsable({ ...base, consumedAt: new Date() })).toEqual({ ok: false, reason: 'consumed' });
    expect(challengeUsable({ ...base, expiresAt: new Date(Date.now() - 1) })).toEqual({ ok: false, reason: 'expired' });
    expect(challengeUsable(base).ok).toBe(true);
  });
});

// ─── fakes ──────────────────────────────────────────────────────────
function user(over: Partial<UserCli> = {}): UserCli {
  return {
    id: 1, name: 'hugo', auth2: false, phone: null, ipsUsing: [],
    timestampCreation: new Date(), timestampPasswordChange: null, timestampLastSession: null,
    ...over,
  };
}

function deps(over: Partial<{ u: UserCli | null; challenge: LoginChallenge | null; sms: SmsSender['send'] }> = {}): LoginDeps {
  let stored: LoginChallenge | null = over.challenge ?? null;
  const users: Partial<UserRepository> = {
    verifyCredentials: async () => over.u ?? null,
    findById: async () => over.u ?? null,
    getBackupCodes: async () => null,
    updateBackupCodes: async () => {},
  };
  const challenges: Partial<LoginChallengeRepository> = {
    create: async (i) => {
      stored = { id: 'ch-new', userId: i.userId, purpose: i.purpose, codeHash: i.codeHash, channel: 'sms', attempts: 0, expiresAt: i.expiresAt, consumedAt: null, createdAt: new Date() };
      return stored;
    },
    findById: async () => stored,
    incrementAttempts: async () => (stored ? ++stored.attempts : 0),
    consume: async () => { if (stored) stored.consumedAt = new Date(); },
  };
  const sms: SmsSender = { send: over.sms ?? (async () => ({ status: 'sent' })) };
  return { users: users as UserRepository, challenges: challenges as LoginChallengeRepository, sms };
}

// ─── login: caminhos sem DB (não chegam no issueSession) ─────────────
describe('login', () => {
  test('credencial errada → bad_credentials', async () => {
    const out = await login('x', 'y', deps({ u: null }));
    expect(out).toEqual({ ok: false, reason: 'bad_credentials' });
  });

  test('auth_2 ligado + phone → 2fa_required (SMS enviado, sem JWT)', async () => {
    const out = await login('hugo', 'pw', deps({ u: user({ auth2: true, phone: '+5511988887777' }) }));
    expect(out.ok).toBe(true);
    expect(out.ok && out.step).toBe('2fa_required');
    expect(out.ok && out.step === '2fa_required' && out.phoneHint).toBe('+55•••••••7777');
  });

  test('SMS não configurado → server_error, challenge consumido', async () => {
    const out = await login('hugo', 'pw', deps({
      u: user({ auth2: true, phone: '+55119' }),
      sms: async () => ({ status: 'skipped' }),
    }));
    expect(out).toEqual({ ok: false, reason: 'server_error', error: expect.stringContaining('não configurado') });
  });

  test('SMS falhou no provedor → server_error', async () => {
    const out = await login('hugo', 'pw', deps({
      u: user({ auth2: true, phone: '+55119' }),
      sms: async () => ({ status: 'failed', error: '429' }),
    }));
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.reason).toBe('server_error');
  });
});

// ─── verifyLogin: caminhos de falha (sem issueSession) ───────────────
describe('verifyLogin', () => {
  const ch = (over: Partial<LoginChallenge> = {}): LoginChallenge => ({
    id: 'ch1', userId: 1, purpose: 'login', codeHash: hashOtp('481920'), channel: 'sms',
    attempts: 0, expiresAt: new Date(Date.now() + 60_000), consumedAt: null, createdAt: new Date(), ...over,
  });

  test('challenge inexistente → not_found', async () => {
    const out = await verifyLogin('nope', '000000', 'otp', deps({ challenge: null }));
    expect(out).toEqual({ ok: false, reason: 'not_found' });
  });

  test('expirado → expired', async () => {
    const out = await verifyLogin('ch1', '481920', 'otp', deps({ challenge: ch({ expiresAt: new Date(Date.now() - 1) }), u: user() }));
    expect(out).toEqual({ ok: false, reason: 'expired' });
  });

  test('OTP errado → invalid com remaining; 3ª vez → attempts_exhausted + requiresBackupCode', async () => {
    const d = deps({ challenge: ch(), u: user() });
    expect(await verifyLogin('ch1', '000001', 'otp', d)).toMatchObject({ ok: false, reason: 'invalid', remaining: 2 });
    expect(await verifyLogin('ch1', '000002', 'otp', d)).toMatchObject({ ok: false, reason: 'invalid', remaining: 1 });
    expect(await verifyLogin('ch1', '000003', 'otp', d)).toMatchObject({ ok: false, reason: 'attempts_exhausted', requiresBackupCode: true });
  });

  test('backup code inválido → invalid', async () => {
    const out = await verifyLogin('ch1', 'AAAAAAAA', 'backup', deps({ challenge: ch(), u: user() }));
    expect(out).toEqual({ ok: false, reason: 'invalid' });
  });
});
