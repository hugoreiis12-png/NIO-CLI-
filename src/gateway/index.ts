#!/usr/bin/env node
/**
 * `nio-gateway` — entrypoint HTTP do Gateway. Node nativo (`http.createServer`,
 * sem framework), sem dependencia externas. Só aceita requests do loopback
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { login, logout } from './services/login.js';
import {
  buildContext,
  extractGatewayToken,
  hasBrowserOrigin,
  logRequest,
  readJsonBody,
  tokensMatch,
} from './edge-filter.js';
import { GATEWAY_PORT } from './config.js';
import { getOrCreateGatewayToken } from '../lib/gateway-token.js';

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** Rotas que exigem o token local — `/health` fica de fora, é só liveness probe. */
const TOKEN_REQUIRED_PATHS = new Set(['/login', '/logout']);

interface LoginBody {
  name?: string;
  password?: string;
}
interface LogoutBody {
  sessionId?: string;
}

async function handleLogin(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJsonBody<LoginBody>(req);
  if (!body.name || !body.password) {
    sendJson(res, 400, { error: 'name e password são obrigatórios' });
    return;
  }
  const result = await login(body.name, body.password);
  if (!result) {
    sendJson(res, 401, { error: 'usuário ou senha inválidos' });
    return;
  }
  sendJson(res, 200, {
    token: result.token,
    userId: result.userId,
    name: result.name,
    sessionId: result.sessionId,
    expiresAt: result.expiresAt.toISOString(),
  });
}

async function handleLogout(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJsonBody<LogoutBody>(req);
  if (!body.sessionId) {
    sendJson(res, 400, { error: 'sessionId é obrigatório' });
    return;
  }
  await logout(body.sessionId);
  sendJson(res, 200, { ok: true });
}

async function main(): Promise<void> {
  // Gerado (ou lido, se outro processo já criou) uma vez no boot — não a
  // cada request. É o gateway quem normalmente sobe primeiro, então isto é
  // o dono comum do arquivo na prática (ver `lib/gateway-token.ts`).
  const gatewayToken = await getOrCreateGatewayToken();

  const server = createServer((req, res) => {
    const ctx = buildContext(req);

    if (hasBrowserOrigin(req)) {
      logRequest(ctx, { rejected: 'origin_de_browser' });
      sendJson(res, 403, { error: 'requests com header Origin não são aceitas' });
      return;
    }

    if (TOKEN_REQUIRED_PATHS.has(ctx.path) && !tokensMatch(extractGatewayToken(req), gatewayToken)) {
      logRequest(ctx, { rejected: 'token_invalido' });
      // 403, não 401 — 401 fica reservado pra "credencial errada" (handleLogin),
      // senão um token de gateway desatualizado pareceria "senha errada" pro
      // usuário e esconderia o problema de conectividade/config de verdade.
      sendJson(res, 403, { error: 'token do gateway ausente ou inválido' });
      return;
    }

    logRequest(ctx);

    void (async () => {
      try {
        if (ctx.method === 'POST' && ctx.path === '/login') return await handleLogin(req, res);
        if (ctx.method === 'POST' && ctx.path === '/logout') return await handleLogout(req, res);
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
