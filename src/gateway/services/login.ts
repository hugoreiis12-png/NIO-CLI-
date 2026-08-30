/**
 * Orquestra o login: credencial → (2º fator, se `auth_2`) → auth_session → JWT
 * (`jti = auth_session.id`). Consome os repos + `SmsSender`, sem saber de HTTP.
 * Ver `docs/specs/auth/0004-login-2fa-sms-otp.md` e ADR 0006.
 */
import jwt from 'jsonwebtoken';
import type { UserCli, LoginChallenge } from '../../core/types.js';
import type { UserRepository, LoginChallengeRepository } from '../../core/repositories.js';
import type { SmsSender } from '../../core/messaging.js';
import { createUserRepository } from '../../adapters/pg/user-repository.js';
import { createAuthSessionRepository } from '../../adapters/pg/auth-session-repository.js';
import { createLoginChallengeRepository } from '../../adapters/pg/login-challenge-repository.js';
import { createHttpSmsSender } from '../../adapters/sms/http-generic.js';
import { generateOtp, hashOtp, verifyOtp } from '../../lib/otp.js';
import { verifyBackupCode, markUsed, countRemaining } from '../../lib/backup-codes.js';
import { getJwtSecret, JWT_EXPIRES_IN } from '../config.js';

export interface SessionPayload {
  token: string;
  userId: number;
  name: string;
  sessionId: string; // = jti embutido no token
  expiresAt: Date;
}

/** TTL do desafio de OTP. */
export const OTP_TTL_MS = 5 * 60 * 1000;
/** Tentativas de OTP antes de cair pro código de backup. */
export const OTP_MAX_ATTEMPTS = 3;

export type LoginOutcome =
  | { ok: false; reason: 'bad_credentials' }
  | { ok: false; reason: 'server_error'; error: string }
  | { ok: true; step: 'done'; session: SessionPayload }
  | { ok: true; step: '2fa_required'; challengeId: string; phoneHint: string };

export type VerifyOutcome =
  | { ok: true; session: SessionPayload; backupCodesRemaining?: number }
  | {
      ok: false;
      reason: 'not_found' | 'expired' | 'consumed' | 'invalid' | 'attempts_exhausted';
      remaining?: number;
      requiresBackupCode?: boolean;
    };

export interface LoginDeps {
  users?: UserRepository;
  challenges?: LoginChallengeRepository;
  sms?: SmsSender;
}

/** Converte '12h' | '30m' | '3600s' | '1d' em milissegundos. Throw se o formato não bater. */
export function expiresInMs(spec: string): number {
  const m = /^(\d+)(s|m|h|d)$/.exec(spec.trim());
  if (!m) {
    throw new Error(`JWT_EXPIRES_IN inválido: "${spec}" (formato esperado: 12h, 30m, 3600s, 1d).`);
  }
  const unit = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as 's' | 'm' | 'h' | 'd'];
  return Number(m[1]) * unit;
}

/** `+5511999998888` → `+55•••••••8888` (mantém DDI + últimos 4). Nunca revela o número inteiro. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '');
  if (digits.length < 8) return '•'.repeat(Math.max(1, digits.length));
  return digits.slice(0, 3) + '•'.repeat(digits.length - 7) + digits.slice(-4);
}

/** Um desafio existe e ainda pode ser usado? (não consumido, não expirado) */
export function challengeUsable(
  ch: LoginChallenge | null,
): { ok: true; ch: LoginChallenge } | { ok: false; reason: 'not_found' | 'consumed' | 'expired' } {
  if (!ch) return { ok: false, reason: 'not_found' };
  if (ch.consumedAt) return { ok: false, reason: 'consumed' };
  if (ch.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'expired' };
  return { ok: true, ch };
}

/** Cria a auth_session e assina o JWT pro usuário já autenticado. */
export async function issueSession(user: UserCli): Promise<SessionPayload> {
  await createUserRepository().touchLastSession(user.id);
  const ms = expiresInMs(JWT_EXPIRES_IN);
  const expiresAt = new Date(Date.now() + ms);
  const session = await createAuthSessionRepository().create({ userId: user.id, expiresAt });
  // `expiresIn` como number (segundos) — `@types/jsonwebtoken` tipa a forma string
  // via `StringValue`, que não aceita `string` genérico de env var.
  const token = jwt.sign(
    { sub: String(user.id), jti: session.id },
    getJwtSecret(),
    { algorithm: 'HS256', expiresIn: Math.floor(ms / 1000) },
  );
  return { token, userId: user.id, name: user.name, sessionId: session.id, expiresAt };
}

/**
 * 1º fator (senha) e, se `auth_2`, dispara o 2º (SMS OTP). Não emite JWT no
 * caminho de 2FA — a rota `/verify-2fa` faz isso via `verifyLogin`.
 */
export async function login(
  name: string,
  password: string,
  deps: LoginDeps = {},
): Promise<LoginOutcome> {
  const users = deps.users ?? createUserRepository();
  const user = await users.verifyCredentials(name, password);
  if (!user) return { ok: false, reason: 'bad_credentials' };

  if (!user.auth2 || !user.phone) {
    return { ok: true, step: 'done', session: await issueSession(user) };
  }

  const challenges = deps.challenges ?? createLoginChallengeRepository();
  const sms = deps.sms ?? createHttpSmsSender();
  const code = generateOtp();
  const challenge = await challenges.create({
    userId: user.id,
    purpose: 'login',
    codeHash: hashOtp(code),
    channel: 'sms',
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
  });

  const sent = await sms.send(user.phone, `NIO: seu código de confirmação é ${code} (expira em 5 min).`);
  if (sent.status === 'skipped') {
    await challenges.consume(challenge.id).catch(() => {});
    return { ok: false, reason: 'server_error', error: '2FA não configurado no servidor (SMS_*).' };
  }
  if (sent.status === 'failed') {
    await challenges.consume(challenge.id).catch(() => {});
    return { ok: false, reason: 'server_error', error: `falha ao enviar o SMS: ${sent.error ?? ''}`.trim() };
  }

  return {
    ok: true,
    step: '2fa_required',
    challengeId: challenge.id,
    phoneHint: maskPhone(user.phone),
  };
}

/** Valida o 2º fator (OTP ou código de backup) e emite o JWT. */
export async function verifyLogin(
  challengeId: string,
  code: string,
  type: 'otp' | 'backup',
  deps: LoginDeps = {},
): Promise<VerifyOutcome> {
  const users = deps.users ?? createUserRepository();
  const challenges = deps.challenges ?? createLoginChallengeRepository();

  const usable = challengeUsable(await challenges.findById(challengeId));
  if (!usable.ok) return { ok: false, reason: usable.reason };
  const ch = usable.ch;

  const user = await users.findById(ch.userId);
  if (!user) return { ok: false, reason: 'not_found' };

  if (type === 'backup') {
    const stored = await users.getBackupCodes(ch.userId);
    const idx = await verifyBackupCode(code, stored);
    if (idx < 0) return { ok: false, reason: 'invalid' };
    await users.updateBackupCodes(ch.userId, markUsed(stored!, idx));
    await challenges.consume(ch.id);
    return {
      ok: true,
      session: await issueSession(user),
      backupCodesRemaining: countRemaining(markUsed(stored!, idx)),
    };
  }

  if (verifyOtp(code, ch.codeHash)) {
    await challenges.consume(ch.id);
    return { ok: true, session: await issueSession(user) };
  }

  const attempts = await challenges.incrementAttempts(ch.id);
  if (attempts >= OTP_MAX_ATTEMPTS) {
    return { ok: false, reason: 'attempts_exhausted', requiresBackupCode: true };
  }
  return { ok: false, reason: 'invalid', remaining: OTP_MAX_ATTEMPTS - attempts };
}

/** Revoga a auth_session (logout). Idempotente. */
export async function logout(sessionId: string): Promise<void> {
  await createAuthSessionRepository().revoke(sessionId);
}
