/**
 * Cliente HTTP do `nio-gateway` — usado por `nio login`/`logout` pra falar
 * com o Gateway pelo túnel HTTP em vez de chamar `gateway/services/login.ts`
 * direto em processo. Loopback only (127.0.0.1), mesma máquina do usuário.
 */
import { GATEWAY_URL } from '../gateway/config.js';
import { getOrCreateGatewayToken } from './gateway-token.js';

export interface GatewayLoginResult {
  token: string;
  userId: number;
  name: string;
  sessionId: string;
  /** ISO-8601 — já vem serializado do gateway, não precisa `new Date()`. */
  expiresAt: string;
}

interface ErrorBody {
  error?: string;
}

/** Mensagem acionável quando o gateway não está no ar (ECONNREFUSED etc.). */
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

/** Content-Type + o token local (ver `gateway-token.ts`) — exigido pelo Edge Filter em /login e /logout. */
async function authHeaders(): Promise<Record<string, string>> {
  const token = await getOrCreateGatewayToken();
  return { 'Content-Type': 'application/json', 'X-Nio-Gateway-Token': token };
}

export async function gatewayLogin(name: string, password: string): Promise<GatewayLoginResult | null> {
  let res: Response;
  try {
    res = await fetch(`${GATEWAY_URL}/login`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ name, password }),
    });
  } catch (err) {
    throw unreachableError(err);
  }
  if (res.status === 401) return null;
  if (!res.ok) throw await errorFromResponse(res);
  return (await res.json()) as GatewayLoginResult;
}

export async function gatewayLogout(sessionId: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${GATEWAY_URL}/logout`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ sessionId }),
    });
  } catch (err) {
    throw unreachableError(err);
  }
  if (!res.ok) throw await errorFromResponse(res);
}
