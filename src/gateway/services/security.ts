/**
 * Gerência do 2º fator pelo usuário logado (`nio security …`) — recebe o `userId`
 * já autenticado (Bearer). Cada mudança sensível confirma com um código (OTP por
 * WhatsApp ou backup). Ver `docs/specs/auth/0004-login-2fa-sms-otp.md`.
 */
import type {
  UserRepository,
  LoginChallengeRepository,
  LoginIpRepository,
  AuthEventRepository,
  AuthSessionRepository,
} from '../../core/repositories.js';
import type { OtpSender } from '../../core/messaging.js';
import { createUserRepository } from '../../adapters/pg/user-repository.js';
import { createLoginChallengeRepository } from '../../adapters/pg/login-challenge-repository.js';
import { createLoginIpRepository } from '../../adapters/pg/login-ip-repository.js';
import { createAuthEventRepository } from '../../adapters/pg/auth-event-repository.js';
import { createAuthSessionRepository } from '../../adapters/pg/auth-session-repository.js';
import { createWhatsAppSender, smsMode, smsProviderHost, type SmsMode } from '../../adapters/sms/whatsapp.js';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../../lib/auth/password.js';
import { checkPasswordBreach } from '../../lib/auth/breach-check.js';
import { generateOtp, hashOtp, verifyOtp } from '../../lib/auth/otp.js';
import {
  generateBackupCodes,
  verifyBackupCode,
  markUsed,
  countRemaining,
} from '../../lib/auth/backup-codes.js';
import { challengeUsable, maskPhone, OTP_TTL_MS, OTP_MAX_ATTEMPTS, CHALLENGE_MAX_ATTEMPTS } from './login.js';
import { smsAllowed } from '../throttle.js';
import { currentPepperId } from '../../lib/auth/secrets.js';

export interface SecurityDeps {
  users?: UserRepository;
  challenges?: LoginChallengeRepository;
  sms?: OtpSender;
  loginIps?: LoginIpRepository;
  authEvents?: AuthEventRepository;
  authSessions?: AuthSessionRepository;
}

/**
 * Troca de senha do próprio usuário (TP-2). Prova = a senha atual (não OTP). Ao
 * trocar, **revoga todas as sessões** do usuário — o ponto de rotacionar é uma
 * senha comprometida, então os JWTs antigos têm que morrer.
 */
export async function changePassword(
  userId: number,
  currentPassword: string,
  newPassword: string,
  deps: SecurityDeps = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `senha nova muito curta (mínimo ${MIN_PASSWORD_LENGTH} caracteres)` };
  }
  if (newPassword === currentPassword) {
    return { ok: false, error: 'a senha nova é igual à atual' };
  }
  if ((await checkPasswordBreach(newPassword)).breached) {
    return { ok: false, error: 'senha nova apareceu em vazamento de dados conhecido — escolha outra' };
  }
  const users = deps.users ?? createUserRepository();
  const user = await users.findById(userId);
  if (!user) return { ok: false, error: 'usuário não encontrado' };
  if (!(await users.verifyCredentials(user.name, currentPassword))) {
    return { ok: false, error: 'senha atual incorreta' };
  }
  const { phc, pepperId } = await hashPassword(newPassword);
  await users.updatePasswordHash(userId, phc, pepperId);
  await (deps.authSessions ?? createAuthSessionRepository()).revokeAllByUser(userId);
  return { ok: true };
}

/** E.164: `+` seguido de 8–15 dígitos. */
export function isE164(phone: string): boolean {
  return /^\+\d{8,15}$/.test(phone.trim());
}

type StartResult =
  | {
      ok: true;
      challengeId: string;
      /** Backend de WhatsApp que atendeu — a CLI avisa se for `echo` (dev). */
      smsMode: SmsMode;
      /** Só em `smsMode === 'echo'`: o código, já que nenhuma mensagem real saiu. */
      devCode?: string;
    }
  | { ok: false; error: string };

/** Gera um OTP `enable_2fa` e manda o WhatsApp pro número dado. */
export async function startSecurityChallenge(
  userId: number,
  toPhone: string,
  deps: SecurityDeps = {},
): Promise<StartResult> {
  if (!isE164(toPhone)) return { ok: false, error: 'número inválido (use E.164, ex.: +5511999998888)' };
  // M-4: `enable-2fa` aceita telefone arbitrário — sem cap, um Bearer válido
  // torrava mensagens pra qualquer número (toll fraud).
  if (!smsAllowed(userId, toPhone)) {
    return { ok: false, error: 'muitos códigos solicitados — aguarde alguns minutos.' };
  }
  const challenges = deps.challenges ?? createLoginChallengeRepository();
  const sms = deps.sms ?? createWhatsAppSender();
  const code = generateOtp();
  const challenge = await challenges.create({
    userId,
    purpose: 'enable_2fa',
    codeHash: hashOtp(code),
    channel: 'whatsapp',
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
  });
  const sent = await sms.sendOtp(toPhone, code);
  if (sent.status === 'skipped') {
    await challenges.consume(challenge.id).catch(() => {});
    return { ok: false, error: '2FA não configurado no servidor (WHATSAPP_*).' };
  }
  if (sent.status === 'failed') {
    await challenges.consume(challenge.id).catch(() => {});
    return { ok: false, error: `falha ao enviar o WhatsApp: ${sent.error ?? ''}`.trim() };
  }
  const mode = smsMode();
  return {
    ok: true,
    challengeId: challenge.id,
    smsMode: mode,
    ...(mode === 'echo' ? { devCode: code } : {}),
  };
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

  // Teto absoluto: uma vez esgotado, nenhum código é mais conferido — sem isto o
  // caminho backup nem incrementava o contador, ficando brute-forçável no TTL.
  if (ch.attempts >= CHALLENGE_MAX_ATTEMPTS) return { ok: false, error: 'tentativas esgotadas' };

  if (type === 'backup') {
    const stored = await users.getBackupCodes(userId);
    const idx = await verifyBackupCode(code, stored.codes, stored.pepperId);
    if (idx < 0) {
      const n = await challenges.incrementAttempts(ch.id);
      return { ok: false, error: n >= CHALLENGE_MAX_ATTEMPTS ? 'tentativas esgotadas' : 'código de backup inválido' };
    }
    await users.updateBackupCodes(userId, markUsed(stored.codes!, idx), stored.pepperId);
  } else {
    if (ch.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, error: 'tentativas esgotadas' };
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
  const { codes, hashes, pepperId } = await generateBackupCodes();
  await users.enable2fa(userId, phone.trim(), hashes, pepperId);
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
  const { codes, hashes, pepperId } = await generateBackupCodes();
  await users.updateBackupCodes(userId, hashes, pepperId);
  return { ok: true, backupCodes: codes };
}

export interface SecurityStatus {
  enabled: boolean;
  phoneHint: string | null;
  backupCodesRemaining: number;
  /** Códigos de backup usam um pepper antigo — regenerar (ADR 0011 §A). */
  regenerateBackupCodesRecommended?: boolean;
  /** IPs de login recentes (auditoria — ADR 0011 §F). */
  recentIps: { ip: string; lastSeen: string; count: number }[];
  /** Últimas tentativas de auth falhas do usuário (trilha — ADR 0012). */
  recentFailedAttempts: { at: string; event: string; ip: string | null }[];
  /** Backend de WhatsApp ativo — `echo` (dev, nenhuma mensagem real) / `provider` / `unconfigured`. */
  sms: { mode: SmsMode; host: string | null };
}

export async function status(userId: number, deps: SecurityDeps = {}): Promise<SecurityStatus> {
  const users = deps.users ?? createUserRepository();
  const loginIps = deps.loginIps ?? createLoginIpRepository();
  const authEvents = deps.authEvents ?? createAuthEventRepository();

  const recentIps = (await loginIps.recent(userId, 10).catch(() => [])).map((e) => ({
    ip: e.ip,
    lastSeen: e.lastSeen.toISOString(),
    count: e.count,
  }));
  const recentFailedAttempts = (
    await authEvents.recentFailures({ userId, limit: 5 }).catch(() => [])
  ).map((f) => ({ at: f.at.toISOString(), event: f.event, ip: f.ip }));

  const sms = { mode: smsMode(), host: smsProviderHost() };

  const user = await users.findById(userId);
  if (!user || !user.auth2) {
    return { enabled: false, phoneHint: null, backupCodesRemaining: 0, recentIps, recentFailedAttempts, sms };
  }
  const stored = await users.getBackupCodes(userId);
  return {
    enabled: true,
    phoneHint: user.phone ? maskPhone(user.phone) : null,
    backupCodesRemaining: countRemaining(stored.codes),
    regenerateBackupCodesRecommended:
      stored.codes != null && stored.pepperId !== currentPepperId() ? true : undefined,
    recentIps,
    recentFailedAttempts,
    sms,
  };
}
