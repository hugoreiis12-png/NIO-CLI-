#!/usr/bin/env node
/**
 * `nio-gateway` — entrypoint HTTP do Gateway. Node nativo (`http.createServer`,
 * sem framework nem deps externas), loopback only. Rotas: `/register`, `/login`
 * (1º fator), `/verify-2fa` (2º fator → JWT), `/logout`, `/logout-all`,
 * `/health`, `/security/*`.
 */
import '../lib/load-env.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { login, logout, logoutAll, verifyLogin } from './services/login.js';
import { register } from './services/register.js';
import { loginDelayMs, recordLoginFail, recordLoginOk, sweep } from './throttle.js';
import * as security from './services/security.js';
import { authenticate } from './middleware/auth.js';
import { createUserRepository } from '../adapters/pg/user-repository.js';
import { createLoginIpRepository } from '../adapters/pg/login-ip-repository.js';
import { createAuthEventRepository } from '../adapters/pg/auth-event-repository.js';
import {
  BadRequestError,
  buildContext,
  clientIp,
  extractGatewayToken,
  hasBrowserOrigin,
  logAuthEvent,
  logRequest,
  readJsonBody,
  tokensMatch,
  type RequestContext,
} from './edge-filter.js';
import { GATEWAY_PORT, GATEWAY_HOST } from './config.js';
import { getOrCreateGatewayToken } from '../lib/auth/gateway-token.js';

/** Retenção da auditoria de IP de login (ADR 0011 §F / LGPD). */
const LOGIN_IP_RETENTION_DAYS = 90;
/** Retenção da trilha de auth (ADR 0012 / LGPD) — janela maior, é forense.
 * Clamp em >= 1: um valor negativo faria o `DELETE` apagar a tabela inteira (TP-5). */
const AUTH_EVENTS_RETENTION_DAYS = Math.max(1, Number(process.env.NIO_AUTH_EVENTS_RETENTION_DAYS) || 180);

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** Rotas que exigem o token local — `/health` fica de fora, é só liveness probe. */
const TOKEN_REQUIRED = (path: string): boolean =>
  path === '/register' ||
  path === '/login' ||
  path === '/logout' ||
  path === '/logout-all' ||
  path === '/verify-2fa' ||
  path.startsWith('/security/');

/** Extrai o `userId` do Bearer JWT (rotas `/security/*`). `null` → já respondeu 401. */
async function requireAuth(req: IncomingMessage, res: ServerResponse): Promise<number | null> {
  const auth = await authenticate(req.headers.authorization);
  if (!auth.ok) {
    sendJson(res, 401, { error: 'não autenticado', reason: auth.reason });
    return null;
  }
  return auth.userId;
}

function sessionJson(s: { token: string; userId: number; name: string; sessionId: string; expiresAt: Date }) {
  return {
    token: s.token,
    userId: s.userId,
    name: s.name,
    sessionId: s.sessionId,
    expiresAt: s.expiresAt.toISOString(),
  };
}

/** Auditoria de IP de login (ADR 0011 §F) — best-effort, nunca afeta a resposta. */
async function recordLoginIp(req: IncomingMessage, userId: number): Promise<void> {
  const ip = clientIp(req);
  if (!ip) return;
  try {
    await createLoginIpRepository().record(userId, ip);
  } catch (err) {
    console.error(JSON.stringify({ ts: new Date().toISOString(), event: 'login_ip_record_failed', error: (err as Error).message }));
  }
}

/**
 * Trilha de auth (ADR 0012): loga no stderr (real-time) **e** grava em
 * `auth_events` (histórico consultável). O INSERT é best-effort — nunca bloqueia
 * a resposta.
 */
function auditAuth(
  req: IncomingMessage,
  ctx: RequestContext,
  event: string,
  meta: { name?: string; userId?: number; reason?: string } = {},
): void {
  logAuthEvent(ctx, event, meta);
  void createAuthEventRepository()
    .record({
      event,
      name: meta.name ?? null,
      userId: meta.userId ?? null,
      ip: clientIp(req),
      traceId: ctx.traceId,
      detail: meta.reason ? { reason: meta.reason } : null,
    })
    .catch((err: unknown) =>
      console.error(
        JSON.stringify({ ts: new Date().toISOString(), event: 'auth_event_record_failed', error: (err as Error).message }),
      ),
    );
}

async function handleRegister(req: IncomingMessage, res: ServerResponse, ctx: RequestContext): Promise<void> {
  const body = await readJsonBody<{ name?: string; password?: string }>(req);
  if (!body.name || !body.password) {
    sendJson(res, 400, { error: 'name e password são obrigatórios' });
    return;
  }
  const out = await register(body.name, body.password);
  if (!out.ok) {
    const msg = {
      invalid_name: 'nome inválido (1–64 chars)',
      weak_password: 'senha muito curta',
      name_taken: 'nome já em uso',
    }[out.reason];
    sendJson(res, out.reason === 'name_taken' ? 409 : 400, { error: msg, reason: out.reason });
    return;
  }
  auditAuth(req, ctx, 'register', { name: out.name, userId: out.userId });
  sendJson(res, 201, {
    userId: out.userId,
    name: out.name,
    ...(out.passwordWarning ? { passwordWarning: out.passwordWarning } : {}),
  });
}

async function handleLogin(req: IncomingMessage, res: ServerResponse, ctx: RequestContext): Promise<void> {
  const body = await readJsonBody<{ name?: string; password?: string }>(req);
  if (!body.name || !body.password) {
    sendJson(res, 400, { error: 'name e password são obrigatórios' });
    return;
  }

  // M-3: atraso escalonado por `name` — brute-force online fica inviável sem
  // trancar a conta de ninguém. Some no primeiro login certo.
  const delay = loginDelayMs(body.name);
  if (delay > 0) await sleep(delay);

  const out = await login(body.name, body.password);
  if (!out.ok) {
    if (out.reason === 'bad_credentials') {
      recordLoginFail(body.name);
      auditAuth(req, ctx, 'password_fail', { name: body.name });
      sendJson(res, 401, { error: 'usuário ou senha inválidos' });
    } else {
      auditAuth(req, ctx, 'password_ok', { name: body.name, reason: 'sms_error' });
      sendJson(res, 503, { error: out.error });
    }
    return;
  }
  recordLoginOk(body.name); // senha certa (com ou sem 2FA pendente)
  if (out.step === 'done') {
    auditAuth(req, ctx, 'password_ok', { name: body.name, userId: out.session.userId });
    void recordLoginIp(req, out.session.userId);
    sendJson(res, 200, { step: 'done', ...sessionJson(out.session) });
    return;
  }
  auditAuth(req, ctx, '2fa_sent', { name: body.name });
  sendJson(res, 200, {
    step: '2fa_required',
    challengeId: out.challengeId,
    phoneHint: out.phoneHint,
    smsMode: out.smsMode,
    devCode: out.devCode,
  });
}

async function handleVerify2fa(req: IncomingMessage, res: ServerResponse, ctx: RequestContext): Promise<void> {
  const body = await readJsonBody<{ challengeId?: string; code?: string; type?: 'otp' | 'backup' }>(req);
  if (!body.challengeId || !body.code) {
    sendJson(res, 400, { error: 'challengeId e code são obrigatórios' });
    return;
  }
  const out = await verifyLogin(body.challengeId, body.code, body.type === 'backup' ? 'backup' : 'otp');
  if (!out.ok) {
    auditAuth(req, ctx, out.reason === 'expired' ? '2fa_expired' : '2fa_fail', {
      reason: out.reason,
      userId: out.userId,
    });
    const status = out.reason === 'attempts_exhausted' ? 429 : 401;
    sendJson(res, status, {
      error: 'código incorreto ou expirado',
      reason: out.reason,
      remaining: out.remaining,
      requiresBackupCode: out.requiresBackupCode,
    });
    return;
  }
  auditAuth(req, ctx, '2fa_ok', { userId: out.session.userId });
  void recordLoginIp(req, out.session.userId);
  sendJson(res, 200, { step: 'done', ...sessionJson(out.session), backupCodesRemaining: out.backupCodesRemaining });
}

async function handleLogout(req: IncomingMessage, res: ServerResponse, ctx: RequestContext): Promise<void> {
  // Só revoga a sessão do próprio Bearer — sem isto, qualquer um com o token do
  // gateway revogava sessão alheia por `sessionId` (auditoria L-5).
  const auth = await authenticate(req.headers.authorization);
  if (!auth.ok) {
    // Token já inválido/revogado/expirado → não há o que revogar; o cliente
    // limpa o estado local do mesmo jeito.
    sendJson(res, 200, { ok: true });
    return;
  }
  await logout(auth.sessionId);
  auditAuth(req, ctx, 'logout', { userId: auth.userId });
  sendJson(res, 200, { ok: true });
}

async function handleLogoutAll(req: IncomingMessage, res: ServerResponse, ctx: RequestContext): Promise<void> {
  const auth = await authenticate(req.headers.authorization);
  if (!auth.ok) {
    sendJson(res, 200, { ok: true }); // nada ativo pra revogar; cliente limpa local
    return;
  }
  await logoutAll(auth.userId);
  auditAuth(req, ctx, 'logout_all', { userId: auth.userId });
  sendJson(res, 200, { ok: true });
}

async function handleSecurity(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RequestContext,
  path: string,
): Promise<void> {
  const userId = await requireAuth(req, res);
  if (userId === null) return;

  if (req.method === 'GET' && path === '/security/status') {
    sendJson(res, 200, await security.status(userId));
    return;
  }

  const body = await readJsonBody<{
    phone?: string;
    challengeId?: string;
    code?: string;
    type?: 'otp' | 'backup';
    currentPassword?: string;
    newPassword?: string;
  }>(req);
  const type = body.type === 'backup' ? 'backup' : 'otp';

  if (path === '/security/change-password') {
    if (!body.currentPassword || !body.newPassword) {
      return sendJson(res, 400, { error: 'currentPassword e newPassword são obrigatórios' });
    }
    const r = await security.changePassword(userId, body.currentPassword, body.newPassword);
    auditAuth(req, ctx, r.ok ? 'password_changed' : 'password_fail', {
      userId,
      reason: r.ok ? undefined : r.error,
    });
    return sendJson(res, r.ok ? 200 : 401, r.ok ? { ok: true } : { error: r.error });
  }

  if (path === '/security/enable-2fa') {
    // envia o OTP pro número NOVO (o usuário ainda não tem phone registrado)
    if (!body.phone) return sendJson(res, 400, { error: 'phone é obrigatório' });
    const r = await security.startSecurityChallenge(userId, body.phone);
    if (!r.ok) return sendJson(res, 400, { error: r.error });
    return sendJson(res, 200, { challengeId: r.challengeId, smsMode: r.smsMode, devCode: r.devCode });
  }

  if (path === '/security/challenge') {
    // envia o OTP pro número REGISTRADO (pra confirmar disable / regenerate)
    const user = await createUserRepository().findById(userId);
    if (!user?.phone) return sendJson(res, 400, { error: '2FA não está ativo' });
    const r = await security.startSecurityChallenge(userId, user.phone);
    if (!r.ok) return sendJson(res, 400, { error: r.error });
    return sendJson(res, 200, { challengeId: r.challengeId, smsMode: r.smsMode, devCode: r.devCode });
  }

  if (!body.challengeId || !body.code) {
    return sendJson(res, 400, { error: 'challengeId e code são obrigatórios' });
  }

  if (path === '/security/confirm-2fa') {
    if (!body.phone) return sendJson(res, 400, { error: 'phone é obrigatório' });
    const r = await security.confirmEnable2fa(userId, body.challengeId, body.code, body.phone);
    auditAuth(req, ctx, r.ok ? '2fa_enabled' : '2fa_fail', { userId, reason: r.ok ? undefined : r.error });
    return sendJson(res, r.ok ? 200 : 401, r.ok ? { backupCodes: r.backupCodes } : { error: r.error });
  }
  if (path === '/security/disable-2fa') {
    const r = await security.disable2fa(userId, body.challengeId, body.code, type);
    auditAuth(req, ctx, r.ok ? '2fa_disabled' : '2fa_fail', { userId, reason: r.ok ? undefined : r.error });
    return sendJson(res, r.ok ? 200 : 401, r.ok ? { ok: true } : { error: r.error });
  }
  if (path === '/security/regenerate-backup-codes') {
    const r = await security.regenerateBackupCodes(userId, body.challengeId, body.code, type);
    return sendJson(res, r.ok ? 200 : 401, r.ok ? { backupCodes: r.backupCodes } : { error: r.error });
  }
  sendJson(res, 404, { error: 'rota desconhecida' });
}

async function main(): Promise<void> {
  // TP-1 (migration 0008): o gateway usa o role privilegiado `nio_gateway`.
  // Roda antes de qualquer `getPool()`. Fallback: `NIO_DATABASE_URL` (setup
  // single-role legado).
  if (process.env.NIO_GATEWAY_DATABASE_URL?.trim()) {
    process.env.NIO_DATABASE_URL = process.env.NIO_GATEWAY_DATABASE_URL.trim();
  }

  const gatewayToken = await getOrCreateGatewayToken();

  const server = createServer((req, res) => {
    const ctx = buildContext(req);

    if (hasBrowserOrigin(req)) {
      logRequest(ctx, { rejected: 'origin_de_browser' });
      sendJson(res, 403, { error: 'requests com header Origin não são aceitas' });
      return;
    }

    if (TOKEN_REQUIRED(ctx.path) && !tokensMatch(extractGatewayToken(req), gatewayToken)) {
      logRequest(ctx, { rejected: 'token_invalido' });
      sendJson(res, 403, { error: 'token do gateway ausente ou inválido' });
      return;
    }

    logRequest(ctx);

    void (async () => {
      try {
        if (ctx.method === 'POST' && ctx.path === '/register') return await handleRegister(req, res, ctx);
        if (ctx.method === 'POST' && ctx.path === '/login') return await handleLogin(req, res, ctx);
        if (ctx.method === 'POST' && ctx.path === '/verify-2fa') return await handleVerify2fa(req, res, ctx);
        if (ctx.method === 'POST' && ctx.path === '/logout') return await handleLogout(req, res, ctx);
        if (ctx.method === 'POST' && ctx.path === '/logout-all') return await handleLogoutAll(req, res, ctx);
        if (ctx.path.startsWith('/security/')) return await handleSecurity(req, res, ctx, ctx.path);
        if (ctx.method === 'GET' && ctx.path === '/health') return sendJson(res, 200, { ok: true });
        sendJson(res, 404, { error: 'rota desconhecida' });
      } catch (err) {
        logRequest(ctx, { error: (err as Error).message, stack: (err as Error).stack });
        if (err instanceof BadRequestError) {
          sendJson(res, 400, { error: err.message });
        } else {
          // Não vaza mensagem interna (erro de DB, stack) pro cliente — só o
          // traceId pra correlacionar com o log (auditoria L-3).
          sendJson(res, 500, { error: 'erro interno ao processar a request', traceId: ctx.traceId });
        }
      }
    })();
  });

  // GC das janelas de rate limiting em memória (M-3/M-4) — `unref` pra não
  // segurar o processo.
  setInterval(() => sweep(), 5 * 60_000).unref();

  // Retenção das trilhas de auditoria (LGPD) — no boot e 1×/dia.
  //   login_ip_events → 90 d (ADR 0011 §F)   ·   auth_events → 180 d (ADR 0012)
  const pruneAudit = async () => {
    try {
      const a = await createLoginIpRepository().pruneOlderThan(LOGIN_IP_RETENTION_DAYS);
      const b = await createAuthEventRepository().pruneOlderThan(AUTH_EVENTS_RETENTION_DAYS);
      if (a + b > 0) console.error(`[nio-gateway] retenção: -${a} login_ip_events, -${b} auth_events`);
    } catch {
      /* best-effort */
    }
  };
  void pruneAudit();
  setInterval(() => void pruneAudit(), 24 * 60 * 60_000).unref();

  server.listen(GATEWAY_PORT, GATEWAY_HOST, () => {
    console.error(`[nio-gateway] ouvindo em http://${GATEWAY_HOST}:${GATEWAY_PORT}`);
  });
}

main().catch((err) => {
  console.error(`[nio-gateway] erro fatal: ${(err as Error).message}`);
  process.exit(1);
});
