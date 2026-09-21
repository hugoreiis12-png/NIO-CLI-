/**
 * Aquisição de token do Power BI / Fabric por **service principal**
 * (`client_credentials`). Contrato nunca-lança: falha vira `TokenResult` com
 * `status`. Cacheia o `access_token` até ~1min antes de expirar. Segredos só do env
 * (`AZURE_*`) — nunca logados nem persistidos; o token fica só em memória.
 */

const TOKEN_ENDPOINT = (tenant: string): string =>
  `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`;
/** Scope do audience api.powerbi.com (client_credentials). */
const SCOPE = 'https://analysis.windows.net/powerbi/api/.default';
const EXPIRY_SKEW_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;

export interface FabricAuthEnv {
  tenantId?: string;
  clientId?: string;
  clientSecret?: string;
}

export function readFabricAuthEnv(env: NodeJS.ProcessEnv = process.env): FabricAuthEnv {
  return {
    tenantId: env.AZURE_TENANT_ID?.trim(),
    clientId: env.AZURE_CLIENT_ID?.trim(),
    clientSecret: env.AZURE_CLIENT_SECRET?.trim(),
  };
}

export type TokenStatus = 'ok' | 'unconfigured' | 'unauthorized' | 'unavailable';

export interface TokenResult {
  status: TokenStatus;
  token?: string;
  error?: string;
}

export interface TokenProvider {
  get(): Promise<TokenResult>;
}

/** Provider com cache em memória. `fetchImpl` é seam pra teste (default = `fetch` global). */
export function createTokenProvider(
  auth: FabricAuthEnv = readFabricAuthEnv(),
  fetchImpl: typeof fetch = fetch,
): TokenProvider {
  let cached: { token: string; expiresAt: number } | null = null;

  return {
    async get(): Promise<TokenResult> {
      if (!auth.tenantId || !auth.clientId || !auth.clientSecret) {
        return { status: 'unconfigured', error: 'AZURE_TENANT_ID/CLIENT_ID/CLIENT_SECRET não configurados' };
      }
      if (cached && cached.expiresAt > Date.now()) return { status: 'ok', token: cached.token };

      const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: auth.clientId,
        client_secret: auth.clientSecret,
        scope: SCOPE,
      });
      try {
        const res = await fetchImpl(TOKEN_ENDPOINT(auth.tenantId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!res.ok) {
          const detail = (await res.text().catch(() => '')).slice(0, 300);
          const status: TokenStatus = res.status === 400 || res.status === 401 ? 'unauthorized' : 'unavailable';
          return { status, error: `token endpoint respondeu ${res.status} ${detail}`.trim() };
        }
        const json = (await res.json()) as { access_token?: string; expires_in?: number };
        if (!json.access_token) return { status: 'unavailable', error: 'resposta do token sem access_token' };
        const ttlMs = (json.expires_in ?? 3600) * 1000;
        cached = { token: json.access_token, expiresAt: Date.now() + ttlMs - EXPIRY_SKEW_MS };
        return { status: 'ok', token: json.access_token };
      } catch (err) {
        return { status: 'unavailable', error: (err as Error).message };
      }
    },
  };
}
