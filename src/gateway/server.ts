// Módulo roda via `bun run` diretamente (script dev:gateway) — fora do
// build tsc/dist publicado no npm, por isso usa `Bun.serve()` sem conflito
// com o alvo Node do resto do pacote (ver tsconfig.json exclude).
//
// OAuth 2.0 Authorization Code Flow + PKCE (RFC 7636), sem Supabase e sem
// permissão/perfil nesta etapa — decisão de 2026-07-27, ver spec 0002.
import { createSession, validateSession, revokeSession } from './sessions.js';
import { createAuthorizationCode, consumeAuthorizationCode } from './authorize-store.js';
import { challengeFromVerifier } from './pkce.js';
import { renderAuthorizePage } from './authorize-page.js';
import { logAccess } from './traceability.js';
import type { GatewayUser, LoginResponse, ValidateResponse } from './types.js';

const PORT = Number(process.env.GATEWAY_PORT ?? 8787);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** RFC 8252 (OAuth pra apps nativos): só redirect_uri de loopback é aceito. */
function isLoopbackRedirect(uri: string): boolean {
  try {
    const u = new URL(uri);
    return (u.hostname === 'localhost' || u.hostname === '127.0.0.1') && u.protocol === 'http:';
  } catch {
    return false;
  }
}

function handleAuthorizeGet(req: Request): Response {
  const url = new URL(req.url);
  const clientId = url.searchParams.get('client_id');
  const redirectUri = url.searchParams.get('redirect_uri');
  const codeChallenge = url.searchParams.get('code_challenge');
  const method = url.searchParams.get('code_challenge_method');
  const state = url.searchParams.get('state');

  if (url.searchParams.get('response_type') !== 'code' || method !== 'S256') {
    return json({ error: 'unsupported_response_type' }, 400);
  }
  if (!clientId || !redirectUri || !codeChallenge || !state) {
    return json({ error: 'invalid_request', reason: 'client_id, redirect_uri, code_challenge e state são obrigatórios' }, 400);
  }
  if (!isLoopbackRedirect(redirectUri)) {
    return json({ error: 'invalid_request', reason: 'redirect_uri precisa ser loopback (localhost/127.0.0.1)' }, 400);
  }

  return new Response(renderAuthorizePage({ clientId, redirectUri, codeChallenge, state }), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

async function handleAuthorizePost(req: Request): Promise<Response> {
  const form = await req.formData();
  const redirectUri = String(form.get('redirect_uri') ?? '');
  const codeChallenge = String(form.get('code_challenge') ?? '');
  const state = String(form.get('state') ?? '');
  const email = String(form.get('email') ?? '').trim();

  if (!redirectUri || !codeChallenge || !email || !isLoopbackRedirect(redirectUri)) {
    return json({ error: 'invalid_request' }, 400);
  }

  const code = createAuthorizationCode({ codeChallenge, redirectUri, email });
  logAccess({ event: 'login_approved', email });

  const redirect = new URL(redirectUri);
  redirect.searchParams.set('code', code);
  redirect.searchParams.set('state', state);
  return Response.redirect(redirect.toString(), 302);
}

async function handleToken(req: Request): Promise<Response> {
  let body: { code?: string; code_verifier?: string; redirect_uri?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ approved: false, reason: 'corpo inválido' } satisfies LoginResponse, 400);
  }
  const { code, code_verifier: verifier, redirect_uri: redirectUri } = body;
  if (!code || !verifier || !redirectUri) {
    return json({ approved: false, reason: 'code, code_verifier e redirect_uri são obrigatórios' } satisfies LoginResponse, 400);
  }

  const pending = consumeAuthorizationCode(code);
  if (!pending) {
    return json({ approved: false, reason: 'code inválido, expirado ou já usado' } satisfies LoginResponse, 400);
  }
  if (pending.redirectUri !== redirectUri || challengeFromVerifier(verifier) !== pending.codeChallenge) {
    logAccess({ event: 'login_rejected', email: pending.email, reason: 'pkce_mismatch' });
    return json({ approved: false, reason: 'PKCE inválido' } satisfies LoginResponse, 400);
  }

  const user: GatewayUser = { id: pending.email.toLowerCase(), email: pending.email };
  const { token, expiresIn } = createSession(user);
  logAccess({ event: 'session_validated', userId: user.id, email: user.email });
  return json({ approved: true, token, expires_in: expiresIn, user } satisfies LoginResponse);
}

async function handleValidate(req: Request): Promise<Response> {
  let body: { token?: string };
  try {
    body = (await req.json()) as { token?: string };
  } catch {
    return json({ approved: false, reason: 'corpo inválido' } satisfies ValidateResponse, 400);
  }
  if (!body.token) return json({ approved: false, reason: 'token ausente' } satisfies ValidateResponse, 400);

  const user = validateSession(body.token);
  if (!user) return json({ approved: false, reason: 'sessão inválida ou expirada' } satisfies ValidateResponse, 401);

  logAccess({ event: 'session_validated', userId: user.id });
  return json({ approved: true, user } satisfies ValidateResponse);
}

async function handleLogout(req: Request): Promise<Response> {
  let body: { token?: string };
  try {
    body = (await req.json()) as { token?: string };
  } catch {
    return json({ ok: false }, 400);
  }
  if (!body.token) return json({ ok: false }, 400);

  const revoked = revokeSession(body.token);
  if (revoked) logAccess({ event: 'session_revoked' });
  return json({ ok: revoked });
}

export const server = Bun.serve({
  port: PORT,
  routes: {
    '/authorize': {
      GET: handleAuthorizeGet,
      POST: handleAuthorizePost,
    },
    '/token': { POST: handleToken },
    '/auth/validate': { POST: handleValidate },
    '/auth/logout': { POST: handleLogout },
  },
  fetch() {
    return json({ error: 'not found' }, 404);
  },
});

console.error(`[gateway] ouvindo em http://localhost:${server.port}`);
