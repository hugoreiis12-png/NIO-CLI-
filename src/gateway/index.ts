#!/usr/bin/env node
/**
 * `nio-gateway` — entrypoint HTTP do Gateway. Node nativo (`http.createServer`,
 * sem framework nem deps externas), loopback only. Rotas: `/login` (1º fator),
 * `/verify-2fa` (2º fator → JWT), `/logout`, `/health`, `/security/*` (Bearer).
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { login, logout, verifyLogin } from './services/login.js';
import * as security from './services/security.js';
import { authenticate } from './middleware/auth.js';
import { createUserRepository } from '../adapters/pg/user-repository.js';
import {
  buildContext,
  extractGatewayToken,
  hasBrowserOrigin,
  logAuthEvent,
  logRequest,
  readJsonBody,
  tokensMatch,
  type RequestContext,
} from './edge-filter.js';
import { GATEWAY_PORT } from './config.js';
import { getOrCreateGatewayToken } from '../lib/gateway-token.js';

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** Rotas que exigem o token local — `/health` fica de fora, é só liveness probe. */
const TOKEN_REQUIRED = (path: string): boolean =>
  path === '/login' || path === '/logout' || path === '/verify-2fa' || path.startsWith('/security/');

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

async function handleLogin(req: IncomingMessage, res: ServerResponse, ctx: RequestContext): Promise<void> {
  const body = await readJsonBody<{ name?: string; password?: string }>(req);
  if (!body.name || !body.password) {
    sendJson(res, 400, { error: 'name e password são obrigatórios' });
    return;
  }
  const out = await login(body.name, body.password);
  if (!out.ok) {
    if (out.reason === 'bad_credentials') {
      logAuthEvent(ctx, 'password_fail', { name: body.name });
      sendJson(res, 401, { error: 'usuário ou senha inválidos' });
    } else {
      logAuthEvent(ctx, 'password_ok', { name: body.name });
      sendJson(res, 503, { error: out.error });
    }
    return;
  }
  if (out.step === 'done') {
    logAuthEvent(ctx, 'password_ok', { name: body.name, userId: out.session.userId });
    sendJson(res, 200, { step: 'done', ...sessionJson(out.session) });
    return;
  }
  logAuthEvent(ctx, '2fa_sent', { name: body.name });
  sendJson(res, 200, { step: '2fa_required', challengeId: out.challengeId, phoneHint: out.phoneHint });
}

async function handleVerify2fa(req: IncomingMessage, res: ServerResponse, ctx: RequestContext): Promise<void> {
  const body = await readJsonBody<{ challengeId?: string; code?: string; type?: 'otp' | 'backup' }>(req);
  if (!body.challengeId || !body.code) {
    sendJson(res, 400, { error: 'challengeId e code são obrigatórios' });
    return;
  }
  const out = await verifyLogin(body.challengeId, body.code, body.type === 'backup' ? 'backup' : 'otp');
  if (!out.ok) {
    logAuthEvent(ctx, out.reason === 'expired' ? '2fa_expired' : '2fa_fail', { reason: out.reason });
    const status = out.reason === 'attempts_exhausted' ? 429 : 401;
    sendJson(res, status, {
      error: 'código incorreto ou expirado',
      reason: out.reason,
      remaining: out.remaining,
      requiresBackupCode: out.requiresBackupCode,
    });
    return;
  }
  logAuthEvent(ctx, '2fa_ok', { userId: out.session.userId });
  sendJson(res, 200, { step: 'done', ...sessionJson(out.session), backupCodesRemaining: out.backupCodesRemaining });
}

async function handleLogout(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJsonBody<{ sessionId?: string }>(req);
  if (!body.sessionId) {
    sendJson(res, 400, { error: 'sessionId é obrigatório' });
    return;
  }
  await logout(body.sessionId);
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
  }>(req);
  const type = body.type === 'backup' ? 'backup' : 'otp';

  if (path === '/security/enable-2fa') {
    // envia o OTP pro número NOVO (o usuário ainda não tem phone registrado)
    if (!body.phone) return sendJson(res, 400, { error: 'phone é obrigatório' });
    const r = await security.startSecurityChallenge(userId, body.phone);
    return sendJson(res, r.ok ? 200 : 400, r.ok ? { challengeId: r.challengeId } : { error: r.error });
  }

  if (path === '/security/challenge') {
    // envia o OTP pro número REGISTRADO (pra confirmar disable / regenerate)
    const user = await createUserRepository().findById(userId);
    if (!user?.phone) return sendJson(res, 400, { error: '2FA não está ativo' });
    const r = await security.startSecurityChallenge(userId, user.phone);
    return sendJson(res, r.ok ? 200 : 400, r.ok ? { challengeId: r.challengeId } : { error: r.error });
  }

  if (!body.challengeId || !body.code) {
    return sendJson(res, 400, { error: 'challengeId e code são obrigatórios' });
  }

  if (path === '/security/confirm-2fa') {
    if (!body.phone) return sendJson(res, 400, { error: 'phone é obrigatório' });
    const r = await security.confirmEnable2fa(userId, body.challengeId, body.code, body.phone);
    logAuthEvent(ctx, r.ok ? '2fa_enabled' : '2fa_fail', { userId });
    return sendJson(res, r.ok ? 200 : 401, r.ok ? { backupCodes: r.backupCodes } : { error: r.error });
  }
  if (path === '/security/disable-2fa') {
    const r = await security.disable2fa(userId, body.challengeId, body.code, type);
    logAuthEvent(ctx, r.ok ? '2fa_disabled' : '2fa_fail', { userId });
    return sendJson(res, r.ok ? 200 : 401, r.ok ? { ok: true } : { error: r.error });
  }
  if (path === '/security/regenerate-backup-codes') {
    const r = await security.regenerateBackupCodes(userId, body.challengeId, body.code, type);
    return sendJson(res, r.ok ? 200 : 401, r.ok ? { backupCodes: r.backupCodes } : { error: r.error });
  }
  sendJson(res, 404, { error: 'rota desconhecida' });
}

async function main(): Promise<void> {
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
        if (ctx.method === 'POST' && ctx.path === '/login') return await handleLogin(req, res, ctx);
        if (ctx.method === 'POST' && ctx.path === '/verify-2fa') return await handleVerify2fa(req, res, ctx);
        if (ctx.method === 'POST' && ctx.path === '/logout') return await handleLogout(req, res);
        if (ctx.path.startsWith('/security/')) return await handleSecurity(req, res, ctx, ctx.path);
        if (ctx.method === 'GET' && ctx.path === '/health') return sendJson(res, 200, { ok: true });
        sendJson(res, 404, { error: 'rota desconhecida' });
      } catch (err) {
        logRequest(ctx, { error: (err as Error).message });
        sendJson(res, 400, { error: (err as Error).message });
      }
    })();
  });

  server.listen(GATEWAY_PORT, '127.0.0.1', () => {
    console.error(`[nio-gateway] ouvindo em http://127.0.0.1:${GATEWAY_PORT}`);
  });
}

main().catch((err) => {
  console.error(`[nio-gateway] erro fatal: ${(err as Error).message}`);
  process.exit(1);
});
