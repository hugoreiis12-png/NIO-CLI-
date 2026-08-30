/**
 * Gerência do 2º fator pelo usuário logado (`nio security …`) — recebe o `userId`
 * já autenticado (Bearer). Cada mudança sensível confirma com um código (OTP por
 * SMS ou backup). Ver `docs/specs/auth/0004-login-2fa-sms-otp.md`.
 */
import type { UserRepository, LoginChallengeRepository } from '../../core/repositories.js';
import type { SmsSender } from '../../core/messaging.js';
import { createUserRepository } from '../../adapters/pg/user-repository.js';
import { createLoginChallengeRepository } from '../../adapters/pg/login-challenge-repository.js';
import { createHttpSmsSender } from '../../adapters/sms/http-generic.js';
import { generateOtp, hashOtp, verifyOtp } from '../../lib/otp.js';
import {
  generateBackupCodes,
  verifyBackupCode,
  markUsed,
  countRemaining,
} from '../../lib/backup-codes.js';
import { challengeUsable, maskPhone, OTP_TTL_MS, OTP_MAX_ATTEMPTS } from './login.js';

export interface SecurityDeps {
  users?: UserRepository;
  challenges?: LoginChallengeRepository;
  sms?: SmsSender;
}

/** E.164: `+` seguido de 8–15 dígitos. */
export function isE164(phone: string): boolean {
  return /^\+\d{8,15}$/.test(phone.trim());
}

type StartResult = { ok: true; challengeId: string } | { ok: false; error: string };

/** Gera um OTP `enable_2fa` e manda o SMS pro número dado. */
export async function startSecurityChallenge(
  userId: number,
  toPhone: string,
  deps: SecurityDeps = {},
): Promise<StartResult> {
  if (!isE164(toPhone)) return { ok: false, error: 'número inválido (use E.164, ex.: +5511999998888)' };
  const challenges = deps.challenges ?? createLoginChallengeRepository();
  const sms = deps.sms ?? createHttpSmsSender();
  const code = generateOtp();
  const challenge = await challenges.create({
    userId,
    purpose: 'enable_2fa',
    codeHash: hashOtp(code),
    channel: 'sms',
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
  });
  const sent = await sms.send(toPhone, `NIO: seu código de confirmação é ${code} (expira em 5 min).`);
  if (sent.status === 'skipped') {
    await challenges.consume(challenge.id).catch(() => {});
    return { ok: false, error: '2FA não configurado no servidor (SMS_*).' };
  }
  if (sent.status === 'failed') {
    await challenges.consume(challenge.id).catch(() => {});
    return { ok: false, error: `falha ao enviar o SMS: ${sent.error ?? ''}`.trim() };
  }
  return { ok: true, challengeId: challenge.id };
}

/** Confere o código de um desafio `enable_2fa` do próprio usuário. Consome se OK. */
async function consumeSecurityCode(
  userId: number,
  challengeId: string,
  code: string,
  type: 'otp' | 'backup',
  deps: SecurityDeps,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const challenges = deps.challenges ?? createLoginChallengeRepository();
  const users = deps.users ?? createUserRepository();
  const usable = challengeUsable(await challenges.findById(challengeId));
  if (!usable.ok) return { ok: false, error: `desafio ${usable.reason}` };
  const ch = usable.ch;
  if (ch.userId !== userId || ch.purpose !== 'enable_2fa') {
    return { ok: false, error: 'desafio não corresponde' };
  }

  if (type === 'backup') {
    const stored = await users.getBackupCodes(userId);
    const idx = await verifyBackupCode(code, stored);
    if (idx < 0) return { ok: false, error: 'código de backup inválido' };
    await users.updateBackupCodes(userId, markUsed(stored!, idx));
  } else {
    if (!verifyOtp(code, ch.codeHash)) {
      const n = await challenges.incrementAttempts(ch.id);
      return {
        ok: false,
        error: n >= OTP_MAX_ATTEMPTS ? 'tentativas esgotadas' : 'código inválido',
      };
    }
  }
  await challenges.consume(ch.id);
  return { ok: true };
}

export async function confirmEnable2fa(
  userId: number,
  challengeId: string,
  code: string,
  phone: string,
  deps: SecurityDeps = {},
): Promise<{ ok: true; backupCodes: string[] } | { ok: false; error: string }> {
  const res = await consumeSecurityCode(userId, challengeId, code, 'otp', deps);
  if (!res.ok) return res;
  const users = deps.users ?? createUserRepository();
  const { codes, hashes } = await generateBackupCodes();
  await users.enable2fa(userId, phone.trim(), hashes);
  return { ok: true, backupCodes: codes };
}

export async function disable2fa(
  userId: number,
  challengeId: string,
  code: string,
  type: 'otp' | 'backup',
  deps: SecurityDeps = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await consumeSecurityCode(userId, challengeId, code, type, deps);
  if (!res.ok) return res;
  await (deps.users ?? createUserRepository()).disable2fa(userId);
  return { ok: true };
}

export async function regenerateBackupCodes(
  userId: number,
  challengeId: string,
  code: string,
  type: 'otp' | 'backup',
  deps: SecurityDeps = {},
): Promise<{ ok: true; backupCodes: string[] } | { ok: false; error: string }> {
  const res = await consumeSecurityCode(userId, challengeId, code, type, deps);
  if (!res.ok) return res;
  const users = deps.users ?? createUserRepository();
  const { codes, hashes } = await generateBackupCodes();
  await users.updateBackupCodes(userId, hashes);
  return { ok: true, backupCodes: codes };
}

export async function status(
  userId: number,
  deps: SecurityDeps = {},
): Promise<{ enabled: boolean; phoneHint: string | null; backupCodesRemaining: number }> {
  const users = deps.users ?? createUserRepository();
  const user = await users.findById(userId);
  if (!user || !user.auth2) return { enabled: false, phoneHint: null, backupCodesRemaining: 0 };
  return {
    enabled: true,
    phoneHint: user.phone ? maskPhone(user.phone) : null,
    backupCodesRemaining: countRemaining(await users.getBackupCodes(userId)),
  };
}
