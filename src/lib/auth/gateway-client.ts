/**
 * Cliente HTTP do `nio-gateway` — `nio login`/`logout`/`verify-2fa` e `nio
 * security …` falam com o Gateway pelo túnel HTTP (via Kong). Loopback only
 * (127.0.0.1), mesma máquina do usuário.
 */
import { GATEWAY_URL } from '../../gateway/config.js';
import { getOrCreateGatewayToken } from './gateway-token.js';
import { dlog } from '../debug.js';

/** Sessão emitida — a CLI grava isto em `~/.nio/session.json`. */
export interface GatewaySession {
  token: string;
  userId: number;
  name: string;
  sessionId: string;
  /** ISO-8601 — já serializado pelo gateway. */
  expiresAt: string;
}

/** Resultado do `POST /login`: sessão pronta, ou 2º fator pendente. */
export type GatewayLoginResult =
  | ({ step: 'done' } & GatewaySession)
  | { step: '2fa_required'; challengeId: string; phoneHint: string };

export type Verify2faResult =
  | ({ ok: true; backupCodesRemaining?: number } & GatewaySession)
  | { ok: false; reason: string; remaining?: number; requiresBackupCode?: boolean };

interface ErrorBody {
  error?: string;
}

function unreachableError(cause: unknown): Error {
  return new Error(
    `Não consegui falar com o nio-gateway em ${GATEWAY_URL} — ele está rodando? ` +
      `Rode \`nio-gateway\` numa outra janela antes de tentar de novo. (${(cause as Error).message ?? cause})`,
  );
}

async function errorFromResponse(res: Response): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as ErrorBody;
  return new Error(body.error ?? `gateway respondeu ${res.status}`);
}

async function baseHeaders(): Promise<Record<string, string>> {
  return { 'Content-Type': 'application/json', 'X-Nio-Gateway-Token': await getOrCreateGatewayToken() };
}

/** `baseHeaders` + `Authorization: Bearer` (rotas `/security/*`). */
async function authedHeaders(token: string): Promise<Record<string, string>> {
  return { ...(await baseHeaders()), Authorization: `Bearer ${token}` };
}

async function post<T>(path: string, body: unknown, headers: Record<string, string>): Promise<T> {
  let res: Response;
  dlog(`POST ${GATEWAY_URL}${path}`);
  try {
    res = await fetch(`${GATEWAY_URL}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  } catch (err) {
    throw unreachableError(err);
  }
  dlog(`  → ${res.status} ${res.statusText}`);
  if (!res.ok) throw await errorFromResponse(res);
  return (await res.json()) as T;
}

export async function gatewayLogin(name: string, password: string): Promise<GatewayLoginResult | null> {
  let res: Response;
  try {
    res = await fetch(`${GATEWAY_URL}/login`, {
      method: 'POST',
      headers: await baseHeaders(),
      body: JSON.stringify({ name, password }),
    });
  } catch (err) {
    throw unreachableError(err);
  }
  if (res.status === 401) return null; // usuário/senha inválidos
  if (!res.ok) throw await errorFromResponse(res);
  return (await res.json()) as GatewayLoginResult;
}

/** `POST /verify-2fa` — não lança em 401/429 (código errado), devolve `{ ok: false }`. */
export async function gatewayVerify2fa(
  challengeId: string,
  code: string,
  type: 'otp' | 'backup',
): Promise<Verify2faResult> {
  let res: Response;
  try {
    res = await fetch(`${GATEWAY_URL}/verify-2fa`, {
      method: 'POST',
      headers: await baseHeaders(),
      body: JSON.stringify({ challengeId, code, type }),
    });
  } catch (err) {
    throw unreachableError(err);
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 401 || res.status === 429) {
    return {
      ok: false,
      reason: String(body.reason ?? 'invalid'),
      remaining: body.remaining as number | undefined,
      requiresBackupCode: body.requiresBackupCode as boolean | undefined,
    };
  }
  if (!res.ok) throw new Error((body.error as string) ?? `gateway respondeu ${res.status}`);
  return { ok: true, ...(body as unknown as GatewaySession), backupCodesRemaining: body.backupCodesRemaining as number };
}

export async function gatewayLogout(sessionId: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${GATEWAY_URL}/logout`, {
      method: 'POST',
      headers: await baseHeaders(),
      body: JSON.stringify({ sessionId }),
    });
  } catch (err) {
    throw unreachableError(err);
  }
  if (!res.ok) throw await errorFromResponse(res);
}

/** Rotas `nio security …` (exigem Bearer + o token do gateway). */
export const gatewaySecurity = {
  status: async (token: string) => {
    let res: Response;
    try {
      res = await fetch(`${GATEWAY_URL}/security/status`, { headers: await authedHeaders(token) });
    } catch (err) {
      throw unreachableError(err);
    }
    if (!res.ok) throw await errorFromResponse(res);
    return (await res.json()) as { enabled: boolean; phoneHint: string | null; backupCodesRemaining: number };
  },

  enable: async (token: string, phone: string) =>
    post<{ challengeId: string }>('/security/enable-2fa', { phone }, await authedHeaders(token)),

  confirmEnable: async (token: string, challengeId: string, code: string, phone: string) =>
    post<{ backupCodes: string[] }>(
      '/security/confirm-2fa',
      { challengeId, code, phone },
      await authedHeaders(token),
    ),

  challenge: async (token: string) =>
    post<{ challengeId: string }>('/security/challenge', {}, await authedHeaders(token)),

  disable: async (token: string, challengeId: string, code: string, type: 'otp' | 'backup') =>
    post<{ ok: true }>('/security/disable-2fa', { challengeId, code, type }, await authedHeaders(token)),

  regenerateBackupCodes: async (token: string, challengeId: string, code: string, type: 'otp' | 'backup') =>
    post<{ backupCodes: string[] }>(
      '/security/regenerate-backup-codes',
      { challengeId, code, type },
      await authedHeaders(token),
    ),
};
