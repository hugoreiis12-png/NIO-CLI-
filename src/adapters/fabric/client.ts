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
import { createTokenProvider, type TokenProvider, type TokenResult } from './token.js';

const API_BASE = 'https://api.powerbi.com/v1.0/myorg';
const REQUEST_TIMEOUT_MS = 15_000;
/** executeQueries pode demorar (DAX pesado); teto mais folgado que o das listagens. */
const QUERY_TIMEOUT_MS = 60_000;

interface OdataList<T> {
  value?: T[];
  '@odata.nextLink'?: string;
}

interface ExecuteError {
  code?: string;
  message?: string;
}
interface ExecuteQueriesResponse {
  error?: ExecuteError;
  results?: { error?: ExecuteError; tables?: { rows?: FabricRow[]; error?: ExecuteError }[] }[];
}

/** Extrai a mensagem de erro de DAX do corpo 400 (JSON `{error:{message}}`) ou devolve o texto cru. */
function daxErrorFrom(detail: string): string {
  try {
    const j = JSON.parse(detail) as ExecuteQueriesResponse;
    return j.error?.message ?? j.error?.code ?? detail;
  } catch {
    return detail;
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

function mapHttpFailure(code: number, detail: string): FabricResult<never> {
  const msg = `Power BI respondeu ${code} ${detail}`.trim();
  if (code === 401 || code === 403) return { status: 'unauthorized', error: msg };
  return { status: 'failed', error: msg };
}

export function createFabricGateway(deps: FabricClientDeps = {}): FabricGateway {
  const token = deps.token ?? createTokenProvider();
  const doFetch = deps.fetchImpl ?? fetch;

  async function getPaged<T>(path: string): Promise<FabricResult<T[]>> {
    const t = await token.get();
    if (t.status !== 'ok' || !t.token) return mapTokenFailure(t);
    const items: T[] = [];
    let url: string | undefined = `${API_BASE}${path}`;
    try {
      while (url) {
        const res = await doFetch(url, {
          headers: { Authorization: `Bearer ${t.token}` },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!res.ok) return mapHttpFailure(res.status, (await res.text().catch(() => '')).slice(0, 300));
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
    const t = await token.get();
    if (t.status !== 'ok' || !t.token) return mapTokenFailure(t);
    const url =
      `${API_BASE}/groups/${encodeURIComponent(workspaceId)}` +
      `/datasets/${encodeURIComponent(datasetId)}/executeQueries`;
    const body = JSON.stringify({ queries: [{ query: dax }], serializerSettings: { includeNulls: true } });
    try {
      const res = await doFetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${t.token}`, 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
      });
      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 500);
        if (res.status === 401 || res.status === 403) {
          return { status: 'unauthorized', error: `Power BI respondeu ${res.status} ${detail}`.trim() };
        }
        return { status: 'failed', error: `Power BI respondeu ${res.status}: ${daxErrorFrom(detail)}`.trim() };
      }
      const json = (await res.json()) as ExecuteQueriesResponse;
      // Erro pode vir com HTTP 200 (ex.: "mais de uma tabela"/"mais de N linhas") — surfacear.
      const result = json.results?.[0];
      const embedded = json.error ?? result?.error ?? result?.tables?.[0]?.error;
      if (embedded) return { status: 'failed', error: embedded.message ?? embedded.code ?? 'erro de DAX' };
      return { status: 'ok', data: result?.tables?.[0]?.rows ?? [] };
    } catch (err) {
      return { status: 'unavailable', error: (err as Error).message };
    }
  }

  return {
    listWorkspaces: () => getPaged<FabricWorkspace>('/groups'),
    listDatasets: (workspaceId) =>
      getPaged<FabricDataset>(`/groups/${encodeURIComponent(workspaceId)}/datasets`),
    executeDax,
  };
}
