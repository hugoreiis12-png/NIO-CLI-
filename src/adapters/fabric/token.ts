/**
 * Aquisição de token do Power BI / Fabric. Dois grants, auto-selecionados por env:
 * - **token de usuário (ROPC, grant `password`)** quando há `NIO_FABRIC_USERNAME`+
 *   `NIO_FABRIC_PASSWORD` → a consulta roda como o usuário e **respeita o RLS**.
 * - **service principal (`client_credentials`)** caso contrário (dataset sem RLS).
 * Contrato nunca-lança: falha vira `TokenResult` com `status`. Cacheia o
 * `access_token` até ~1min antes de expirar. Segredos só do env — nunca logados nem
 * persistidos; o token fica só em memória.
 */

import { refreshAccessToken } from './device-code.js';
import { readRefreshToken, saveRefreshToken } from './refresh-store.js';

const TOKEN_ENDPOINT = (tenant: string): string =>
  `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`;
/** Scope do audience api.powerbi.com. */
const SCOPE = 'https://analysis.windows.net/powerbi/api/.default';
const EXPIRY_SKEW_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;
/** Corpo lido para parse (o `error_description` do Entra é longo) e teto exibido. */
const ERROR_BODY_CHARS = 2_000;
const ERROR_DETAIL_CHARS = 300;
/** Janelas em que a falha fica cacheada — ver `failureResult`. */
const UNAUTHORIZED_BLOCK_MS = 60_000;
const UNAVAILABLE_BLOCK_MS = 15_000;
const DEFAULT_RETRY_AFTER_S = 30;

export interface FabricAuthEnv {
  tenantId?: string;
  clientId?: string;
  clientSecret?: string;
  username?: string;
  password?: string;
  /** Refresh token de um `nio fabric login` anterior (device code). */
  deviceRefreshToken?: string;
}

export function readFabricAuthEnv(env: NodeJS.ProcessEnv = process.env): FabricAuthEnv {
  return {
    tenantId: env.AZURE_TENANT_ID?.trim(),
    clientId: env.AZURE_CLIENT_ID?.trim(),
    clientSecret: env.AZURE_CLIENT_SECRET?.trim(),
    username: env.NIO_FABRIC_USERNAME?.trim(),
    password: env.NIO_FABRIC_PASSWORD, // senha sem trim — pode ter caractere significativo na borda
  };
}

/**
 * Contexto completo: o env **mais** o login salvo em `~/.nio`. É o que produção
 * usa. `readFabricAuthEnv` fica puro para os testes não dependerem de a máquina
 * ter ou não um login guardado.
 */
export function readFabricAuth(env: NodeJS.ProcessEnv = process.env): FabricAuthEnv {
  const base = readFabricAuthEnv(env);
  return {
    ...base,
    deviceRefreshToken: readRefreshToken(base.tenantId, base.clientId) ?? undefined,
  };
}

// Exporta só para teste; o resto da CLI não precisa saber do grant nem do endpoint
export type TokenGrant = 'device' | 'user' | 'service_principal';
export type TokenStatus = 'ok' | 'unconfigured' | 'unauthorized' | 'unavailable';

export interface TokenResult {
  status: TokenStatus;
  token?: string;
  grant?: TokenGrant;
  error?: string;
}

export interface TokenProvider {
  get(): Promise<TokenResult>;
  /** Descarta o token em cache — 401/403 da API significa expirado ou revogado. */
  invalidate?(): void;
}

/**
 * Qual grant a credencial habilita, ou `null` se falta credencial.
 *
 * Ordem: **device** > usuário (ROPC) > service principal. O device vence porque
 * é token de usuário real — executa em dataset com RLS, onde o service principal
 * é barrado por design —, e porque quem rodou `nio fabric login` quer usá-lo.
 */
export function fabricGrant(auth: FabricAuthEnv = readFabricAuth()): TokenGrant | null {
  if (!auth.tenantId || !auth.clientId) return null;
  if (auth.deviceRefreshToken) return 'device';
  if (auth.username && auth.password) return 'user';
  if (auth.clientSecret) return 'service_principal';
  return null;
}

/** Monta o corpo do grant escolhido (ROPC ou client_credentials). */
function grantBody(grant: TokenGrant, auth: FabricAuthEnv): URLSearchParams {
  if (grant === 'user') {
    const body = new URLSearchParams({
      grant_type: 'password',
      client_id: auth.clientId!,
      username: auth.username!,
      password: auth.password!,
      scope: SCOPE,
    });
    if (auth.clientSecret) body.set('client_secret', auth.clientSecret); // app confidencial
    return body;
  }
  return new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: auth.clientId!,
    client_secret: auth.clientSecret!,
    scope: SCOPE,
  });
}

/** Dicas por código AADSTS — só os que mudam a ação do usuário (doc: reference-error-codes). */
const AAD_HINTS: ReadonlyArray<[RegExp, string]> = [
  [
    /AADSTS5007[69]|AADSTS53003|AADSTS50158/,
    'a conta exige MFA/Conditional Access — o grant de usuário (ROPC) não passa por MFA; use service principal ou peça exceção ao admin',
  ],
  [
    /AADSTS7000222/,
    'client secret EXPIRADO — gere outro em Entra → App registrations → Certificates & secrets e atualize AZURE_CLIENT_SECRET',
  ],
  [
    /AADSTS7000215|AADSTS7000218/,
    'client secret inválido ou ausente — AZURE_CLIENT_SECRET é o Value do segredo, não o Secret ID',
  ],
  [/AADSTS50126/, 'usuário ou senha inválidos (NIO_FABRIC_USERNAME/NIO_FABRIC_PASSWORD)'],
  [/AADSTS50053/, 'conta bloqueada por tentativas repetidas — aguarde antes de tentar de novo'],
  [/AADSTS5005[57]|AADSTS50034/, 'conta desabilitada, senha expirada ou usuário fora do tenant'],
  [
    /AADSTS65001|AADSTS90094/,
    'app sem consentimento — o admin precisa conceder as permissões (Power BI Service) ao app',
  ],
  [
    /AADSTS700016|AADSTS90002|AADSTS500011/,
    'tenant ou client id errado — confira AZURE_TENANT_ID/AZURE_CLIENT_ID',
  ],
];

/** Traduz o corpo de erro do Entra em mensagem acionável, preservando o código AADSTS. */
export function describeAadFailure(status: number, body: string): string {
  let desc = body;
  try {
    const j = JSON.parse(body) as { error?: string; error_description?: string };
    desc = [j.error, j.error_description].filter(Boolean).join(': ') || body;
  } catch {
    desc = body; // corpo não-JSON (HTML de proxy, etc.): mostra cru
  }
  const code = /AADSTS\d+/.exec(desc)?.[0];
  const hint = code ? AAD_HINTS.find(([re]) => re.test(code))?.[1] : undefined;
  const head = `token endpoint respondeu ${status}${code ? ` (${code})` : ''}`;
  return hint ? `${head}: ${hint}` : `${head} ${desc.slice(0, ERROR_DETAIL_CHARS)}`.trim();
}

/** Segundos do header `Retry-After` (429) — número ou data HTTP; `null` se ausente. */
export function retryAfterSeconds(res: Response): number | null {
  const raw = res.headers.get('retry-after');
  if (!raw) return null;
  const n = Number(raw);
  if (Number.isFinite(n)) return Math.max(0, Math.ceil(n));
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, Math.ceil((at - Date.now()) / 1000)) : null;
}

function unconfiguredResult(): TokenResult {
  return {
    status: 'unconfigured',
    error:
      'Fabric não configurado: defina AZURE_TENANT_ID/AZURE_CLIENT_ID e ' +
      '(NIO_FABRIC_USERNAME/NIO_FABRIC_PASSWORD p/ token de usuário com RLS, ' +
      'ou AZURE_CLIENT_SECRET p/ service principal).',
  };
}

/**
 * Falha + por quanto tempo não vale a pena repetir. Repetir uma chamada que vai
 * falhar igual não é resiliência: no 429 piora o limite, e no 400 gasta 10 s de
 * timeout por tool do agente para receber a mesma resposta.
 */
function failureResult(res: Response, body: string): { result: TokenResult; blockMs: number } {
  if (res.status === 429) {
    const s = retryAfterSeconds(res);
    return {
      result: {
        status: 'unavailable',
        error: `token endpoint limitou (429)${s !== null ? ` — aguarde ${s}s` : ''}`,
      },
      // O servidor disse quando voltar; obedecer é o mínimo. Sem header, 30 s.
      blockMs: (s ?? DEFAULT_RETRY_AFTER_S) * 1000,
    };
  }
  const status: TokenStatus =
    res.status === 400 || res.status === 401 ? 'unauthorized' : 'unavailable';
  return {
    result: { status, error: describeAadFailure(res.status, body) },
    // Credencial recusada não se conserta sozinha — só com `nio config setup`,
    // que chama invalidate() e derruba este bloqueio na hora.
    blockMs: status === 'unauthorized' ? UNAUTHORIZED_BLOCK_MS : UNAVAILABLE_BLOCK_MS,
  };
}

/** Resultado interno de uma aquisição — o `get` só decide cache a partir disto. */
type Acquisition =
  | { ok: true; token: string; ttlMs: number }
  | { ok: false; result: TokenResult; blockMs: number };

/**
 * Device code: troca o refresh por um access novo. O Entra **rotaciona** o
 * refresh a cada troca, então o novo é persistido — não fazer isso faz o login
 * morrer sozinho na renovação seguinte.
 */
async function acquireViaDevice(
  auth: FabricAuthEnv,
  fetchImpl: typeof fetch,
): Promise<Acquisition> {
  // Lê do store, e não de `auth`: em processo longo (MCP server) o refresh é
  // rotacionado a cada renovação, então o que veio em `auth` fica obsoleto logo
  // na primeira — e a segunda renovação falharia com um erro opaco do Entra.
  const atual = readRefreshToken(auth.tenantId, auth.clientId) ?? auth.deviceRefreshToken ?? '';
  const r = await refreshAccessToken(auth, atual, fetchImpl);
  if (r.status !== 'ok') {
    return {
      ok: false,
      result: {
        status: 'unauthorized',
        error: `a sessão do \`nio fabric login\` não vale mais (${r.error}) — rode o login de novo`,
      },
      blockMs: UNAUTHORIZED_BLOCK_MS,
    };
  }
  saveRefreshToken(r.data.refreshToken, auth);
  return { ok: true, token: r.data.accessToken, ttlMs: r.data.expiresInSec * 1000 };
}

/** ROPC ou client_credentials: um POST no token endpoint. */
async function acquireViaEndpoint(
  auth: FabricAuthEnv,
  grant: TokenGrant,
  fetchImpl: typeof fetch,
): Promise<Acquisition> {
  try {
    const res = await fetchImpl(TOKEN_ENDPOINT(auth.tenantId!), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: grantBody(grant, auth),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const { result, blockMs } = failureResult(
        res,
        (await res.text().catch(() => '')).slice(0, ERROR_BODY_CHARS),
      );
      return { ok: false, result, blockMs };
    }
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) {
      return {
        ok: false,
        result: { status: 'unavailable', error: 'resposta do token sem access_token' },
        blockMs: UNAVAILABLE_BLOCK_MS,
      };
    }
    return { ok: true, token: json.access_token, ttlMs: (json.expires_in ?? 3600) * 1000 };
  } catch (err) {
    // Timeout/DNS/rede: 10 s perdidos por tentativa — segurar vale ainda mais.
    return {
      ok: false,
      result: { status: 'unavailable', error: (err as Error).message },
      blockMs: UNAVAILABLE_BLOCK_MS,
    };
  }
}

/** Provider com cache em memória. `fetchImpl` é seam pra teste (default = `fetch` global). */
export function createTokenProvider(
  auth: FabricAuthEnv = readFabricAuth(),
  fetchImpl: typeof fetch = fetch,
): TokenProvider {
  let cached: { token: string; expiresAt: number; grant: TokenGrant } | null = null;
  let blocked: { until: number; result: TokenResult } | null = null;

  /** Guarda a falha e devolve — a próxima chamada dentro da janela reusa isto. */
  const hold = (result: TokenResult, blockMs: number): TokenResult => {
    blocked = { until: Date.now() + blockMs, result };
    return result;
  };

  return {
    // Também derruba o bloqueio: quem chama isto acabou de trocar a credencial.
    invalidate: () => {
      cached = null;
      blocked = null;
    },
    async get(): Promise<TokenResult> {
      const grant = fabricGrant(auth);
      if (!auth.tenantId || !grant) return unconfiguredResult();
      if (cached && cached.expiresAt > Date.now()) {
        return { status: 'ok', token: cached.token, grant: cached.grant };
      }
      if (blocked && blocked.until > Date.now()) return blocked.result;

      const got =
        grant === 'device'
          ? await acquireViaDevice(auth, fetchImpl)
          : await acquireViaEndpoint(auth, grant, fetchImpl);

      if (!got.ok) return hold(got.result, got.blockMs);
      cached = { token: got.token, expiresAt: Date.now() + got.ttlMs - EXPIRY_SKEW_MS, grant };
      blocked = null;
      return { status: 'ok', token: got.token, grant };
    },
  };
}

const shared = new Map<string, TokenProvider>();

/**
 * Um provider por credencial no processo: o cache do token vale entre tool calls.
 *
 * O default é `readFabricAuth` (com o login salvo), não `readFabricAuthEnv` — é
 * por aqui que as tools MCP e o gateway REST pegam o token, e com o env puro elas
 * ignorariam o `nio fabric login` e voltariam ao service principal em silêncio.
 *
 * O refresh entra na chave para que trocar de conta (logout + login) não reuse o
 * provider da anterior: com RLS, isso significaria responder com os dados da
 * pessoa errada até o access token expirar.
 */
export function sharedTokenProvider(auth: FabricAuthEnv = readFabricAuth()): TokenProvider {
  const key = JSON.stringify([
    auth.tenantId,
    auth.clientId,
    auth.username,
    auth.clientSecret,
    auth.password,
    auth.deviceRefreshToken?.slice(-24),
  ]);
  let provider = shared.get(key);
  if (!provider) {
    provider = createTokenProvider(auth);
    shared.set(key, provider);
  }
  return provider;
}
