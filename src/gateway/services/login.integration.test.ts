/**
 * Integração do fluxo de login 2FA contra o Postgres real — o fio que hoje só
 * tinha fake (`login.test.ts` usa `LoginDeps` fake). Cobre: `login()` grava um
 * `login_challenges` de verdade → `verifyLogin()` lê, valida o OTP/backup e emite
 * o JWT → `auth_sessions` ganha a linha, o challenge é consumido.
 *
 * Gated em `NIO_DATABASE_URL` + `JWT_SECRET` (sem eles → pula). Usuário descartável.
 */
import { test, expect, afterAll } from 'bun:test';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { createUserRepository } from '../../adapters/pg/user-repository.js';
import { createLoginChallengeRepository } from '../../adapters/pg/login-challenge-repository.js';
import { query, closePool } from '../../adapters/pg/client.js';
import { generateBackupCodes } from '../../lib/auth/backup-codes.js';
import type { SmsResult, SmsSender } from '../../core/messaging.js';
import { login, verifyLogin } from './login.js';

const hasEnv = Boolean(process.env.NIO_DATABASE_URL && process.env.JWT_SECRET);
const dbTest = hasEnv ? test : test.skip;

afterAll(async () => {
  if (hasEnv) await closePool();
});

/** SmsSender fake que captura o código de 6 dígitos da mensagem. */
function captureSms(): SmsSender & { code: string | null } {
  const box = {
    code: null as string | null,
    async send(_to: string, text: string): Promise<SmsResult> {
      box.code = text.match(/\b(\d{6})\b/)?.[1] ?? null;
      return { status: 'sent' };
    },
  };
  return box;
}

dbTest(
  'login 2FA: challenge real → verifyLogin (OTP, backup, esgotado, expirado, consumido)',
  async () => {
    const users = createUserRepository();
    const challenges = createLoginChallengeRepository();
    const password = `pw-${randomUUID()}`;
    const user = await users.create({ name: `nio-2fa-${randomUUID()}`, password });
    const { codes: backupCodes, hashes } = await generateBackupCodes();
    await users.enable2fa(user.id, '+5511999998888', hashes);

    try {
      // ── caminho feliz: OTP ────────────────────────────────────────────
      const sms = captureSms();
      const started = await login(user.name, password, { sms });
      expect(started.ok).toBe(true);
      if (!started.ok || started.step !== '2fa_required') throw new Error('esperava 2fa_required');
      expect(started.phoneHint).toContain('8888');
      expect(sms.code).toMatch(/^\d{6}$/);

      const done = await verifyLogin(started.challengeId, sms.code!, 'otp');
      expect(done.ok).toBe(true);
      if (!done.ok) throw new Error('verifyLogin falhou');

      // JWT válido, jti == a auth_session criada
      const decoded = jwt.verify(done.session.token, process.env.JWT_SECRET!) as { sub: string; jti: string };
      expect(decoded.sub).toBe(String(user.id));
      expect(decoded.jti).toBe(done.session.sessionId);
      const as = await query('SELECT id FROM auth_sessions WHERE id = $1', [done.session.sessionId]);
      expect(as.rowCount).toBe(1);
      // challenge consumido
      const ch = await challenges.findById(started.challengeId);
      expect(ch?.consumedAt).not.toBeNull();
      // reusar o challenge consumido → recusa
      expect((await verifyLogin(started.challengeId, sms.code!, 'otp')).ok).toBe(false);

      // ── OTP errado ×3 → attempts_exhausted + requiresBackupCode ───────
      const sms2 = captureSms();
      const s2 = await login(user.name, password, { sms: sms2 });
      if (!s2.ok || s2.step !== '2fa_required') throw new Error('esperava 2fa_required');
      let last;
      for (let i = 0; i < 3; i++) last = await verifyLogin(s2.challengeId, '000000', 'otp');
      expect(last!.ok).toBe(false);
      if (last!.ok) throw new Error();
      expect(last!.reason).toBe('attempts_exhausted');
      expect(last!.requiresBackupCode).toBe(true);
      // agora um backup code resolve
      const viaBackup = await verifyLogin(s2.challengeId, backupCodes[0]!, 'backup');
      expect(viaBackup.ok).toBe(true);

      // ── challenge expirado ───────────────────────────────────────────
      const sms3 = captureSms();
      const s3 = await login(user.name, password, { sms: sms3 });
      if (!s3.ok || s3.step !== '2fa_required') throw new Error();
      await query('UPDATE login_challenges SET expires_at = NOW() - INTERVAL \'1 minute\' WHERE id = $1', [s3.challengeId]);
      expect((await verifyLogin(s3.challengeId, sms3.code!, 'otp')).ok).toBe(false);

      // ── challenge inexistente ────────────────────────────────────────
      const nope = await verifyLogin(randomUUID(), '123456', 'otp');
      expect(nope.ok).toBe(false);
    } finally {
      await query('DELETE FROM user_cli WHERE id = $1', [user.id]);
    }
  },
  30_000,
);

dbTest('login 1FA: usuário sem auth_2 → step done + auth_session', async () => {
  const users = createUserRepository();
  const password = `pw-${randomUUID()}`;
  const user = await users.create({ name: `nio-1fa-${randomUUID()}`, password });
  try {
    const out = await login(user.name, password);
    expect(out.ok).toBe(true);
    if (!out.ok || out.step !== 'done') throw new Error('esperava done');
    const decoded = jwt.verify(out.session.token, process.env.JWT_SECRET!) as { jti: string };
    expect(decoded.jti).toBe(out.session.sessionId);
    expect((await query('SELECT 1 FROM auth_sessions WHERE id = $1', [out.session.sessionId])).rowCount).toBe(1);

    expect((await login(user.name, 'senha-errada')).ok).toBe(false);
  } finally {
    await query('DELETE FROM user_cli WHERE id = $1', [user.id]);
  }
}, 20_000);
