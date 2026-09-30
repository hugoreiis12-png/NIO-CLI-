/**
 * Device Authorization Grant (RFC 8628) para o Power BI/Fabric.
 *
 * Existe porque o ROPC (grant `password`) é legacy e o Entra o recusa quando há
 * MFA, Conditional Access ou security defaults — devolvendo `AADSTS50126`
 * ("usuário ou senha inválidos") mesmo com a senha certa. E o service principal,
 * por design da Microsoft, não executa query em dataset com RLS
 * (`isEffectiveIdentityRequired`). Sobra este: token de **usuário real**, obtido
 * sem digitar senha na CLI, que convive com MFA e aplica o RLS de quem logou.
 *
 * Cliente **público**: nunca manda `client_secret` — o device code não o usa.
 * Contrato nunca-lança, como o resto do adapter: falha vira `{ status, error }`.
 */
import type { FabricAuthEnv } from './token.js';

const AUTHORITY = (tenant: string): string =>
  `https://login.microsoftonline.com/${encodeURIComponent(tenant)}`;
/** `offline_access` é o que faz o Entra devolver refresh_token. */
const SCOPE = 'https://analysis.windows.net/powerbi/api/.default offline_access';
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const REQUEST_TIMEOUT_MS = 15_000;
/** `slow_down` do servidor manda espaçar o poll; o RFC sugere +5 s por vez. */
const SLOW_DOWN_STEP_MS = 5_000;
const ERROR_CHARS = 240;

export type DeviceResult<T> = { status: 'ok'; data: T } | { status: 'failed'; error: string };

export interface DeviceCodeStart {
  /** O código que a pessoa digita no navegador. */
  userCode: string;
  verificationUri: string;
  expiresInSec: number;
  intervalSec: number;
  /** Segredo do fluxo — usado no poll, nunca exibido nem logado. */
  deviceCode: string;
}

export interface DeviceTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
}

export interface PollOptions {
  /** Chamado a cada volta, para a UI mostrar que ainda está viva. */
  onWaiting?: (restanteSec: number) => void;
  fetchImpl?: typeof fetch;
  /** Seam de teste: o RFC manda somar 5 s a cada `slow_down` do servidor. */
  slowDownStepMs?: number;
}

function fail(error: string): DeviceResult<never> {
  return { status: 'failed', error: error.slice(0, ERROR_CHARS) };
}

async function postForm(
  url: string,
  body: URLSearchParams,
  fetchImpl: typeof fetch,
): Promise<Response> {
  return fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

/** Passo 1: pede o par device_code/user_code. O user_code é o que a pessoa digita. */
export async function startDeviceAuth(
  auth: FabricAuthEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<DeviceResult<DeviceCodeStart>> {
  if (!auth.tenantId || !auth.clientId) return fail('faltam AZURE_TENANT_ID/AZURE_CLIENT_ID');
  try {
    const res = await postForm(
      `${AUTHORITY(auth.tenantId)}/oauth2/v2.0/devicecode`,
      new URLSearchParams({ client_id: auth.clientId, scope: SCOPE }),
      fetchImpl,
    );
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok)
      return fail(`${j.error ?? res.status}: ${String(j.error_description ?? '').split('\n')[0]}`);
    if (!j.device_code || !j.user_code)
      return fail('resposta do devicecode sem device_code/user_code');
    return {
      status: 'ok',
      data: {
        deviceCode: String(j.device_code),
        userCode: String(j.user_code),
        verificationUri: String(j.verification_uri ?? 'https://login.microsoft.com/device'),
        expiresInSec: Number(j.expires_in ?? 900),
        intervalSec: Number(j.interval ?? 5),
      },
    };
  } catch (err) {
    return fail((err as Error).message);
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function tokensFrom(j: Record<string, unknown>): DeviceResult<DeviceTokens> {
  if (!j.access_token) return fail('resposta sem access_token');
  if (!j.refresh_token)
    return fail('resposta sem refresh_token — o scope offline_access foi recusado');
  return {
    status: 'ok',
    data: {
      accessToken: String(j.access_token),
      refreshToken: String(j.refresh_token),
      expiresInSec: Number(j.expires_in ?? 3600),
    },
  };
}

/**
 * Passo 2: aguarda a pessoa aprovar no navegador. `onWaiting` é chamado a cada
 * volta para a UI poder mostrar que ainda está vivo. Só retorna quando aprovar,
 * negar ou expirar — o teto é o `expiresInSec` que o servidor definiu.
 */
export async function pollDeviceToken(
  auth: FabricAuthEnv,
  start: DeviceCodeStart,
  opts: PollOptions = {},
): Promise<DeviceResult<DeviceTokens>> {
  const { onWaiting = () => {}, fetchImpl = fetch, slowDownStepMs = SLOW_DOWN_STEP_MS } = opts;
  if (!auth.tenantId || !auth.clientId) return fail('faltam AZURE_TENANT_ID/AZURE_CLIENT_ID');
  const url = `${AUTHORITY(auth.tenantId)}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: DEVICE_GRANT,
    client_id: auth.clientId,
    device_code: start.deviceCode,
  });

  let intervaloMs = start.intervalSec * 1000;
  const prazo = Date.now() + start.expiresInSec * 1000;

  while (Date.now() < prazo) {
    await sleep(intervaloMs);
    onWaiting(Math.max(0, Math.round((prazo - Date.now()) / 1000)));
    try {
      const res = await postForm(url, body, fetchImpl);
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.ok) return tokensFrom(j);

      const erro = String(j.error ?? '');
      if (erro === 'authorization_pending') continue;
      if (erro === 'slow_down') {
        intervaloMs += slowDownStepMs;
        continue;
      }
      if (erro === 'expired_token')
        return fail('o código expirou — rode `nio fabric login` de novo');
      if (erro === 'authorization_declined') return fail('acesso negado no navegador');
      return fail(`${erro}: ${String(j.error_description ?? '').split('\n')[0]}`);
    } catch (err) {
      return fail((err as Error).message);
    }
  }
  return fail('o código expirou antes da aprovação');
}

/** Troca o refresh token por um access token novo. O Entra devolve um refresh rotacionado. */
export async function refreshAccessToken(
  auth: FabricAuthEnv,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DeviceResult<DeviceTokens>> {
  if (!auth.tenantId || !auth.clientId) return fail('faltam AZURE_TENANT_ID/AZURE_CLIENT_ID');
  try {
    const res = await postForm(
      `${AUTHORITY(auth.tenantId)}/oauth2/v2.0/token`,
      new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: auth.clientId,
        refresh_token: refreshToken,
        scope: SCOPE,
      }),
      fetchImpl,
    );
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok)
      return fail(`${j.error ?? res.status}: ${String(j.error_description ?? '').split('\n')[0]}`);
    return tokensFrom(j);
  } catch (err) {
    return fail((err as Error).message);
  }
}
