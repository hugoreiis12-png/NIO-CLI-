import { afterEach, test, expect } from 'bun:test';
process.env.NIO_HIBP_DISABLE = '1'; // SP-7: sem rede nos testes
import { isE164, status, changePassword, startSecurityChallenge, disable2fa } from './security.js';
import { CHALLENGE_MAX_ATTEMPTS } from './login.js';
import { __clear as clearThrottle } from '../throttle.js';
import type {
  UserRepository,
  LoginChallengeRepository,
  LoginIpRepository,
  LoginIpEvent,
  AuthEventRepository,
  AuthFailure,
  AuthSessionRepository,
} from '../../core/repositories.js';
import type { OtpSender } from '../../core/messaging.js';
import type { UserCli, LoginChallenge } from '../../core/types.js';

afterEach(() => {
  clearThrottle();
  delete process.env.WHATSAPP_ENDPOINT_URL;
  delete process.env.WHATSAPP_TOKEN;
  delete process.env.WHATSAPP_TEMPLATE_NAME;
  delete process.env.WHATSAPP_TEMPLATE_LANGUAGE;
});

test('isE164', () => {
  expect(isE164('+5511999998888')).toBe(true);
  expect(isE164(' +551234567 ')).toBe(true);
  expect(isE164('5511999998888')).toBe(false); // sem +
  expect(isE164('+55')).toBe(false); // curto
});

// ─── startSecurityChallenge: modo echo (fix do 2º fator) ─────────────
function challengeDeps() {
  const challenges = {
    create: async () => ({ id: 'ch-1' }),
    consume: async () => {},
  } as unknown as LoginChallengeRepository;
  const sms = { sendOtp: async () => ({ status: 'sent' as const }) } as unknown as OtpSender;
  return { challenges, sms };
}

test('startSecurityChallenge: endpoint loopback → smsMode=echo + devCode', async () => {
  process.env.WHATSAPP_ENDPOINT_URL = 'http://127.0.0.1:4545/send';
  process.env.WHATSAPP_TOKEN = 'dummy';
  const r = await startSecurityChallenge(1, '+5511999998888', challengeDeps());
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error();
  expect(r.smsMode).toBe('echo');
  expect(r.devCode).toMatch(/^\d{6}$/);
});

test('startSecurityChallenge: provedor externo → smsMode=provider, sem devCode', async () => {
  process.env.WHATSAPP_ENDPOINT_URL = 'https://api.provedor.com/sms';
  process.env.WHATSAPP_TOKEN = 'dummy';
  const r = await startSecurityChallenge(1, '+5511999998888', challengeDeps());
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error();
  expect(r.smsMode).toBe('provider');
  expect(r.devCode).toBeUndefined();
});

function fakeUser(over: Partial<UserCli> = {}): UserCli {
  return {
    id: 1, name: 'hugo', auth2: false, phone: null, ipsUsing: [],
    timestampCreation: new Date(), timestampPasswordChange: null, timestampLastSession: null,
    ...over,
  };
}

function deps(over: { user?: UserCli | null; ips?: LoginIpEvent[]; failures?: AuthFailure[] } = {}) {
  const users = {
    findById: async () => (over.user === undefined ? fakeUser() : over.user),
    getBackupCodes: async () => ({ codes: null, pepperId: 0 }),
  } as unknown as UserRepository;
  const loginIps = {
    recent: async () => over.ips ?? [],
  } as unknown as LoginIpRepository;
  const authEvents = {
    recentFailures: async () => over.failures ?? [],
  } as unknown as AuthEventRepository;
  return { users, loginIps, authEvents };
}

test('status: sempre inclui recentIps (mapeado pra { ip, lastSeen ISO, count })', async () => {
  const seen = new Date('2026-09-01T12:00:00Z');
  const st = await status(1, deps({ ips: [{ ip: '203.0.113.9', firstSeen: seen, lastSeen: seen, count: 3 }] }));
  expect(st.recentIps).toEqual([{ ip: '203.0.113.9', lastSeen: seen.toISOString(), count: 3 }]);
});

test('status: recentFailedAttempts mapeado (at ISO, event, ip) — ADR 0012', async () => {
  const at = new Date('2026-09-05T08:30:00Z');
  const st = await status(1, deps({ failures: [{ at, event: 'password_fail', ip: '198.51.100.7' }] }));
  expect(st.recentFailedAttempts).toEqual([
    { at: at.toISOString(), event: 'password_fail', ip: '198.51.100.7' },
  ]);
});

test('status: 2FA inativo → enabled false, mas recentIps/recentFailedAttempts ainda vêm', async () => {
  const st = await status(1, deps({ user: fakeUser({ auth2: false }), ips: [], failures: [] }));
  expect(st.enabled).toBe(false);
  expect(st.recentIps).toEqual([]);
  expect(st.recentFailedAttempts).toEqual([]);
});

test('status: reporta o backend de WhatsApp (fix do 2º fator — B)', async () => {
  process.env.WHATSAPP_ENDPOINT_URL = 'http://127.0.0.1:4545/send';
  process.env.WHATSAPP_TOKEN = 'dummy';
  expect((await status(1, deps())).sms).toEqual({ mode: 'echo', host: '127.0.0.1' });

  delete process.env.WHATSAPP_ENDPOINT_URL;
  delete process.env.WHATSAPP_TOKEN;
  expect((await status(1, deps())).sms).toEqual({ mode: 'unconfigured', host: null });
});

function cpDeps(over: { verified?: boolean; user?: UserCli | null } = {}) {
  const calls = { updatePasswordHash: 0, revokeAllByUser: 0 };
  const users = {
    findById: async () => (over.user === undefined ? fakeUser() : over.user),
    verifyCredentials: async () => (over.verified === false ? null : fakeUser()),
    updatePasswordHash: async () => {
      calls.updatePasswordHash++;
    },
  } as unknown as UserRepository;
  const authSessions = {
    revokeAllByUser: async () => {
      calls.revokeAllByUser++;
    },
  } as unknown as AuthSessionRepository;
  return { deps: { users, authSessions }, calls };
}

test('changePassword: senha nova curta → recusa sem tocar no banco', async () => {
  const { deps, calls } = cpDeps();
  const r = await changePassword(1, 'senha-atual-ok', 'curta', deps);
  expect(r.ok).toBe(false);
  expect(calls.updatePasswordHash).toBe(0);
});

test('changePassword: senha nova == atual → recusa', async () => {
  const { deps } = cpDeps();
  const r = await changePassword(1, 'mesma-senha-123', 'mesma-senha-123', deps);
  expect(r).toEqual({ ok: false, error: 'a senha nova é igual à atual' });
});

test('changePassword: senha atual errada → recusa, não revoga sessões', async () => {
  const { deps, calls } = cpDeps({ verified: false });
  const r = await changePassword(1, 'errada', 'senha-nova-123', deps);
  expect(r).toEqual({ ok: false, error: 'senha atual incorreta' });
  expect(calls.revokeAllByUser).toBe(0);
});

test('changePassword: senha nova comprometida (lista local) → recusa sem tocar no banco', async () => {
  const { deps, calls } = cpDeps();
  const r = await changePassword(1, 'senha-atual-ok', 'qwerty123', deps);
  expect(r.ok).toBe(false);
  expect(calls.updatePasswordHash).toBe(0);
  expect(calls.revokeAllByUser).toBe(0);
});

test('changePassword: ok → grava hash novo e revoga todas as sessões', async () => {
  const { deps, calls } = cpDeps();
  const r = await changePassword(1, 'senha-atual-ok', 'senha-nova-forte-1', deps);
  expect(r).toEqual({ ok: true });
  expect(calls.updatePasswordHash).toBe(1);
  expect(calls.revokeAllByUser).toBe(1);
});

test('status: repos de auditoria que lançam não derrubam o status', async () => {
  const users = { findById: async () => fakeUser(), getBackupCodes: async () => ({ codes: null, pepperId: 0 }) } as unknown as UserRepository;
  const loginIps = { recent: async () => { throw new Error('db down'); } } as unknown as LoginIpRepository;
  const authEvents = { recentFailures: async () => { throw new Error('db down'); } } as unknown as AuthEventRepository;
  const st = await status(1, { users, loginIps, authEvents });
  expect(st.recentIps).toEqual([]);
  expect(st.recentFailedAttempts).toEqual([]);
});

// ─── consumeSecurityCode: teto de tentativas (fix brute-force) ───────
function exhaustedChallengeDeps() {
  const calls = { consume: 0, disable2fa: 0 };
  const challenge: LoginChallenge = {
    id: 'ch-1', userId: 1, purpose: 'enable_2fa', codeHash: 'x', channel: 'whatsapp',
    attempts: CHALLENGE_MAX_ATTEMPTS, expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null, createdAt: new Date(),
  };
  const challenges = {
    findById: async () => challenge,
    incrementAttempts: async () => challenge.attempts,
    consume: async () => { calls.consume++; },
  } as unknown as LoginChallengeRepository;
  const users = {
    getBackupCodes: async () => ({ codes: null, pepperId: 0 }),
    disable2fa: async () => { calls.disable2fa++; },
  } as unknown as UserRepository;
  return { deps: { challenges, users }, calls };
}

test('disable2fa: teto esgotado → recusa sem conferir código nem desativar (fix brute-force)', async () => {
  const { deps, calls } = exhaustedChallengeDeps();
  const r = await disable2fa(1, 'ch-1', 'AAAAAAAA', 'backup', deps);
  expect(r).toEqual({ ok: false, error: 'tentativas esgotadas' });
  expect(calls.consume).toBe(0);
  expect(calls.disable2fa).toBe(0);
});
