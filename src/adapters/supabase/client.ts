import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../constants.js';
import { loadCredentials, exchangePatForJwt, type ExchangeResult } from '../../auth.js';
import type { Database } from '../../database.types.js';
import { brand } from '../../brand.js';

export type DbClient = SupabaseClient<Database>;

export interface AuthenticatedSession {
  supabase: DbClient;
  user: ExchangeResult['user'];
}

/**
 * Lê o `exp` (epoch em segundos) do payload de um JWT. Retorna 0 se não der pra
 * parsear — o chamador trata 0 como "sem validade conhecida" e cai no fallback.
 */
function jwtExp(token: string): number {
  try {
    const payload = token.split('.')[1];
    if (!payload) return 0;
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof json.exp === 'number' ? json.exp : 0;
  } catch {
    return 0;
  }
}

/** Validade absoluta (epoch em s) da troca: usa o `exp` do JWT; se ilegível, deriva do `expires_in`. */
function computeExp(exchange: ExchangeResult): number {
  const fromJwt = jwtExp(exchange.access_token);
  if (fromJwt > 0) return fromJwt;
  return Math.floor(Date.now() / 1000) + (exchange.expires_in ?? 0);
}

/**
 * Carrega PAT, troca por JWT e retorna client Supabase autenticado.
 *
 * O JWT do mcp-token-exchange tem `exp` fixo e o client não tem refresh
 * (autoRefreshToken:false). Chumbar o token num header estático fazia toda chamada
 * falhar com "JWT expired" depois do exp, até reconectar o MCP (que reinicia o
 * processo → nova troca). Em vez disso injetamos um JWT fresco por request via fetch
 * custom, re-trocando o PAT (durável e re-trocável) de duas formas:
 *  - **proativa**: quando falta <300s pro exp (margem larga que absorve skew de relógio);
 *  - **reativa (one-shot)**: se o servidor devolver 401 (ex.: skew mandou um JWT já
 *    expirado), força uma troca fresca e repete a MESMA request UMA vez.
 * Assim a sessão dura indefinidamente sem reconnect, mesmo com relógio dessincronizado.
 *
 * Throw se não há PAT salvo, ou se a troca inicial falhar.
 */
export async function createAuthenticatedClient(): Promise<AuthenticatedSession> {
  const creds = await loadCredentials();
  if (!creds) {
    throw new Error(`Nenhum token encontrado. Rode \`${brand.name} login <PAT>\` antes.`);
  }
  const { pat } = creds;

  const first = await exchangePatForJwt(pat);
  let token = first.access_token;
  let exp = computeExp(first);

  // Re-troca o PAT por um JWT novo, deduplicando trocas concorrentes numa única
  // promise pra não disparar N requests ao token-exchange quando várias tools
  // chamam junto. Usado tanto pela checagem proativa quanto pelo retry reativo.
  let refreshing: Promise<void> | null = null;
  function refreshOnce(): Promise<void> {
    if (!refreshing) {
      refreshing = (async () => {
        const fresh = await exchangePatForJwt(pat);
        token = fresh.access_token;
        exp = computeExp(fresh);
      })().finally(() => {
        refreshing = null;
      });
    }
    return refreshing;
  }

  // Proativo: refresca quando falta <300s pro exp (margem larga pra absorver skew).
  async function validToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (exp - 300 > now) return token;
    await refreshOnce();
    return token;
  }

  const authFetch = async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
    retried = false,
  ): Promise<Response> => {
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${await validToken()}`);
    const res = await fetch(input, { ...init, headers });

    // Reativo (one-shot): se o servidor rejeita o token (401) — ex.: skew mandou um
    // JWT já expirado — força uma troca fresca e repete a MESMA request uma vez.
    if (res.status === 401 && !retried) {
      await refreshOnce();
      return authFetch(input, init, true);
    }
    return res;
  };

  const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    // Cast: nosso wrapper não implementa `fetch.preconnect` (que o supabase-js
    // nunca chama), mas o tipo `Fetch` é `typeof fetch` e exige a propriedade.
    global: { fetch: authFetch as typeof fetch },
  });

  return { supabase, user: first.user };
}
