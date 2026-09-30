/**
 * Adapter REST do Power BI / Fabric (somente leitura): lista workspaces e datasets
 * via `api.powerbi.com` com Bearer do service principal. Implementa `FabricGateway`
 * (`core/fabric.ts`) — contrato nunca-lança: erro vira `FabricResult` com `status`.
 * Pagina o OData (`@odata.nextLink`) — nunca devolve coleção parcial silenciosamente.
 */
import type {
  FabricGateway,
  FabricResult,
  FabricWorkspace,
  FabricDataset,
  FabricRow,
} from '../../core/fabric.js';
import {
  retryAfterSeconds,
  sharedTokenProvider,
  type TokenProvider,
  type TokenResult,
} from './token.js';
import { classifyOutcome, recordQuery, type QueryMetric } from './query-metrics.js';

const API_BASE = 'https://api.powerbi.com/v1.0/myorg';
const REQUEST_TIMEOUT_MS = 15_000;
/** executeQueries pode demorar (DAX pesado); teto mais folgado que o das listagens. */
const QUERY_TIMEOUT_MS = 60_000;

interface OdataList<T> {
  value?: T[];
  '@odata.nextLink'?: string;
}

/** Quanto do corpo de erro lemos antes de parsear — precisa caber o `pbi.error` aninhado. */
const ERROR_BODY_LIMIT = 8_000;
/** Teto do que é exibido ao usuário (o corpo cru pode ser HTML longo em 401/403). */
const MAX_ERROR_MESSAGE = 1_200;

/** Os três motivos reais de 401 no executeQueries (doc: datasets/execute-queries). */
const QUERY_AUTH_HINT =
  ' — confira: (1) tenant setting "Dataset Execute Queries REST API" ligado; (2) a identidade é ' +
  'Member/Admin do workspace ou tem Build no dataset; (3) dataset com RLS/SSO não aceita service ' +
  'principal — use token de usuário.';

/**
 * O diagnóstico DAX acionável do Power BI mora aninhado em
 * `error["pbi.error"].details[].detail.value` (ex.: "Cannot find table 'Metas'").
 * O `error.message` do topo costuma ser genérico ("An unexpected error occurred").
 */
interface PbiErrorDetail {
  detail?: { value?: string };
}
interface PbiError {
  code?: string;
  details?: PbiErrorDetail[];
}
interface ExecuteError {
  code?: string;
  message?: string;
  'pbi.error'?: PbiError;
}
interface ExecuteQueriesResponse {
  error?: ExecuteError;
  results?: { error?: ExecuteError; tables?: { rows?: FabricRow[]; error?: ExecuteError }[] }[];
}

/**
 * Mensagem acionável de um erro do executeQueries. Prioriza os `pbi.error.details[]`
 * (o motivo real do DAX); cai pro `message`/`code` do topo quando não houver.
 * Usado tanto no 400 quanto no erro embutido que vem com HTTP 200.
 */
function messageFrom(err: ExecuteError | undefined): string | undefined {
  if (!err) return undefined;
  const nested = (err['pbi.error']?.details ?? [])
    .map((d) => d.detail?.value?.trim())
    .filter((v): v is string => Boolean(v));
  const code = err.code ?? err['pbi.error']?.code;
  if (nested.length > 0) return `${code ? `${code}: ` : ''}${nested.join(' · ')}`;
  return err.message ?? code;
}

/** Extrai a mensagem de erro de DAX do corpo 400, ou devolve o texto cru. */
function daxErrorFrom(detail: string): string {
  try {
    const j = JSON.parse(detail) as ExecuteQueriesResponse;
    return (messageFrom(j.error) ?? detail).slice(0, MAX_ERROR_MESSAGE);
  } catch {
    return detail.slice(0, MAX_ERROR_MESSAGE);
  }
}

export interface FabricClientDeps {
  token?: TokenProvider;
  fetchImpl?: typeof fetch;
}

function mapTokenFailure(t: TokenResult): FabricResult<never> {
  if (t.status === 'unauthorized') return { status: 'unauthorized', error: t.error };
  if (t.status === 'unavailable') return { status: 'unavailable', error: t.error };
  return { status: 'failed', error: t.error }; // unconfigured
}

function mapHttpFailure(res: Response, detail: string, authHint = ''): FabricResult<never> {
  if (res.status === 429) {
    const s = retryAfterSeconds(res);
    return {
      status: 'throttled',
      error: `Power BI limitou as chamadas (429)${s !== null ? ` — aguarde ${s}s` : ''}`,
    };
  }
  const msg = `Power BI respondeu ${res.status} ${detail}`.trim();
  if (res.status === 401 || res.status === 403)
    return { status: 'unauthorized', error: `${msg}${authHint}` };
  return { status: 'failed', error: msg };
}

type Attempt =
  | { res: Response; failure?: undefined }
  | { res?: undefined; failure: FabricResult<never> };

export function createFabricGateway(deps: FabricClientDeps = {}): FabricGateway {
  const token = deps.token ?? sharedTokenProvider();
  const doFetch = deps.fetchImpl ?? fetch;

  /** fetch com Bearer; em 401/403 descarta o token em cache e repete UMA vez (token expirado). */
  async function authedFetch(
    url: string,
    init: RequestInit,
    timeoutMs: number,
    retried = false,
  ): Promise<Attempt> {
    const t = await token.get();
    if (t.status !== 'ok' || !t.token) return { failure: mapTokenFailure(t) };
    const headers = {
      ...(init.headers as Record<string, string> | undefined),
      Authorization: `Bearer ${t.token}`,
    };
    const res = await doFetch(url, { ...init, headers, signal: AbortSignal.timeout(timeoutMs) });
    if ((res.status === 401 || res.status === 403) && !retried && token.invalidate) {
      token.invalidate();
      return authedFetch(url, init, timeoutMs, true);
    }
    return { res };
  }

  async function getPaged<T>(path: string): Promise<FabricResult<T[]>> {
    const items: T[] = [];
    let url: string | undefined = `${API_BASE}${path}`;
    try {
      while (url) {
        const { res, failure } = await authedFetch(url, {}, REQUEST_TIMEOUT_MS);
        if (failure) return failure;
        if (!res.ok) return mapHttpFailure(res, (await res.text().catch(() => '')).slice(0, 300));
        const json = (await res.json()) as OdataList<T>;
        if (json.value) items.push(...json.value);
        url = json['@odata.nextLink'];
      }
      return { status: 'ok', data: items };
    } catch (err) {
      return { status: 'unavailable', error: (err as Error).message };
    }
  }

  async function executeDax(
    workspaceId: string,
    datasetId: string,
    dax: string,
  ): Promise<FabricResult<FabricRow[]>> {
    const url =
      `${API_BASE}/groups/${encodeURIComponent(workspaceId)}` +
      `/datasets/${encodeURIComponent(datasetId)}/executeQueries`;
    const body = JSON.stringify({
      queries: [{ query: dax }],
      serializerSettings: { includeNulls: true },
    });
    try {
      const { res, failure } = await authedFetch(
        url,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body },
        QUERY_TIMEOUT_MS,
      );
      if (failure) return failure;
      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, ERROR_BODY_LIMIT);
        if (res.status === 401 || res.status === 403 || res.status === 429) {
          return mapHttpFailure(res, detail.slice(0, MAX_ERROR_MESSAGE), QUERY_AUTH_HINT);
        }
        return {
          status: 'failed',
          error: `Power BI respondeu ${res.status}: ${daxErrorFrom(detail)}`.trim(),
        };
      }
      const json = (await res.json()) as ExecuteQueriesResponse;
      // Erro pode vir com HTTP 200 (ex.: "mais de uma tabela"/"mais de N linhas") — surfacear.
      const result = json.results?.[0];
      const embedded = json.error ?? result?.error ?? result?.tables?.[0]?.error;
      if (embedded) return { status: 'failed', error: messageFrom(embedded) ?? 'erro de DAX' };
      return { status: 'ok', data: result?.tables?.[0]?.rows ?? [] };
    } catch (err) {
      return { status: 'unavailable', error: (err as Error).message };
    }
  }

  /**
   * Cronometra e categoriza o resultado. Envolve em vez de espalhar chamadas nos
   * seis pontos de retorno do `executeDax` — e assim também pega o erro de DAX
   * que chega com HTTP 200.
   */
  async function medido<T>(
    op: QueryMetric['op'],
    datasetId: string | undefined,
    exec: () => Promise<FabricResult<T>>,
  ): Promise<FabricResult<T>> {
    const inicio = Date.now();
    const out = await exec();
    recordQuery({
      ts: new Date().toISOString(),
      op,
      outcome: classifyOutcome(out.status, out.error),
      ms: Date.now() - inicio,
      datasetId,
    });
    return out;
  }

  return {
    listWorkspaces: () =>
      medido('listWorkspaces', undefined, () => getPaged<FabricWorkspace>('/groups')),
    listDatasets: (workspaceId) =>
      medido('listDatasets', undefined, () =>
        getPaged<FabricDataset>(`/groups/${encodeURIComponent(workspaceId)}/datasets`),
      ),
    executeDax: (workspaceId, datasetId, dax) =>
      medido('executeDax', datasetId, () => executeDax(workspaceId, datasetId, dax)),
  };
}
