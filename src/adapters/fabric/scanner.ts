/**
 * Scanner admin do Power BI — a única rota que entrega a **fórmula DAX** das medidas.
 *
 * Medido: `INFO.VIEW.MEASURES()` devolve `[Expression]` NULO neste tenant (381 de 381),
 * e a família `INFO.*` sem `VIEW` responde 400. O scanner admin devolve tudo, desde que
 * duas configurações de locatário estejam ligadas para o service principal. Enquanto
 * estiveram desligadas, a própria API dizia o motivo em `dataRetrievalState`:
 * `"DatasetSchemaDisabledByAdmin; DatasetExpressionsDisabledByAdmin"`.
 *
 * Fluxo: `POST getInfo` → 202 com id → poll `scanStatus` até `Succeeded` → `scanResult`.
 * Contrato nunca-lança, como o `FabricGateway`.
 */
import type { TokenProvider } from './token.js';
import { retryAfterSeconds, sharedTokenProvider } from './token.js';

const ADMIN = 'https://api.powerbi.com/v1.0/myorg/admin/workspaces';
const POLL_MS = 2000;
const POLL_MAX = 45; // ~90s: o scan de um workspace grande leva dezenas de segundos
const CALL_TIMEOUT_MS = 15_000;
/** O scanResult de um workspace grande é um JSON de MBs. */
const RESULT_TIMEOUT_MS = 60_000;

/** A API admin tem tenant setting PRÓPRIO (doc: enable-service-principal-admin-apis). */
const ADMIN_AUTH_HINT =
  ' — a API admin exige o tenant setting "Service principals can access read-only admin APIs" ' +
  '(separado do de APIs públicas), o SP no grupo de segurança dele, e o app SEM permissões ' +
  'admin-consent do Power BI.';

export type ScanStatus = 'ok' | 'unconfigured' | 'unauthorized' | 'unavailable' | 'throttled' | 'disabled';

export interface ScanResult<T> {
  status: ScanStatus;
  data?: T;
  error?: string;
}

/** Forma observada no payload real (2026-09-25). */
export interface ScannedColumn {
  name: string;
  dataType?: string;
  isHidden?: boolean;
  columnType?: string;
}

export interface ScannedMeasure {
  name: string;
  expression?: string;
  isHidden?: boolean;
  description?: string;
}

export interface ScannedTable {
  name: string;
  isHidden?: boolean;
  storageMode?: string;
  columns?: ScannedColumn[];
  measures?: ScannedMeasure[];
}

export interface ScannedDataset {
  id: string;
  name: string;
  tables?: ScannedTable[];
}

export interface FabricScanner {
  /** Schema completo de um dataset, com as fórmulas das medidas. */
  scanDataset(workspaceId: string, datasetId: string): Promise<ScanResult<ScannedDataset>>;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * `dataRetrievalState` é a própria API dizendo que os toggles estão desligados. Sem
 * ler isso, o sintoma seria só um payload vazio e o diagnóstico viraria adivinhação —
 * foi o que custou dois dias antes de alguém olhar este campo.
 */
function blockedReason(workspace: Record<string, unknown>): string | null {
  const state = workspace.dataRetrievalState;
  return typeof state === 'string' && state.includes('DisabledByAdmin') ? state : null;
}

/** Traduz um HTTP não-2xx de qualquer etapa do scan. */
async function httpFailure(step: string, res: Response): Promise<ScanResult<never>> {
  if (res.status === 429) {
    const s = retryAfterSeconds(res);
    return { status: 'throttled', error: `${step} limitou (429)${s !== null ? ` — aguarde ${s}s` : ''}` };
  }
  const detalhe = (await res.text().catch(() => '')).slice(0, 200);
  const unauthorized = res.status === 401 || res.status === 403;
  return {
    status: unauthorized ? 'unauthorized' : 'unavailable',
    error: `${step} respondeu ${res.status} ${detalhe}${unauthorized ? ADMIN_AUTH_HINT : ''}`.trim(),
  };
}

function disabledResult(bloqueio: string): ScanResult<never> {
  return {
    status: 'disabled',
    error:
      `o locatário bloqueia os metadados (${bloqueio}). Habilite no portal admin → ` +
      'Configurações do locatário → API de administrador: "Metadados detalhados do ' +
      'conjunto de dados" e "Expressões DAX e mashup do conjunto de dados", com o ' +
      'service principal no grupo de segurança aplicado.',
  };
}

export function createFabricScanner(
  tokens: TokenProvider = sharedTokenProvider(),
  fetchImpl: typeof fetch = fetch,
): FabricScanner {
  async function headers(): Promise<ScanResult<Record<string, string>>> {
    const tok = await tokens.get();
    if (tok.status !== 'ok' || !tok.token) {
      return { status: tok.status === 'unconfigured' ? 'unconfigured' : 'unauthorized', error: tok.error };
    }
    return {
      status: 'ok',
      data: { Authorization: `Bearer ${tok.token}`, 'Content-Type': 'application/json' },
    };
  }

  async function pollUntilDone(id: string, h: Record<string, string>): Promise<ScanResult<never> | null> {
    let estado = '';
    for (let i = 0; i < POLL_MAX && estado !== 'Succeeded'; i++) {
      await sleep(POLL_MS);
      const s = await fetchImpl(`${ADMIN}/scanStatus/${id}`, { headers: h, signal: AbortSignal.timeout(CALL_TIMEOUT_MS) });
      if (!s.ok) return httpFailure('scanStatus', s);
      estado = ((await s.json()) as { status?: string }).status ?? '';
      if (estado === 'Failed') return { status: 'unavailable', error: 'scan falhou no servidor' };
    }
    return estado === 'Succeeded' ? null : { status: 'unavailable', error: `scan não concluiu (${estado})` };
  }

  return {
    async scanDataset(workspaceId, datasetId) {
      const h = await headers();
      if (h.status !== 'ok' || !h.data) return { status: h.status, error: h.error };

      try {
        const start = await fetchImpl(
          `${ADMIN}/getInfo?datasetSchema=True&datasetExpressions=True&lineage=True`,
          { method: 'POST', headers: h.data, body: JSON.stringify({ workspaces: [workspaceId] }), signal: AbortSignal.timeout(CALL_TIMEOUT_MS) },
        );
        if (!start.ok) return httpFailure('getInfo', start);
        const job = (await start.json()) as { id?: string; status?: string };
        if (!job.id) return { status: 'unavailable', error: 'getInfo sem id de scan' };

        if (job.status !== 'Succeeded') {
          const pending = await pollUntilDone(job.id, h.data);
          if (pending) return pending;
        }

        const res = await fetchImpl(`${ADMIN}/scanResult/${job.id}`, { headers: h.data, signal: AbortSignal.timeout(RESULT_TIMEOUT_MS) });
        if (!res.ok) return httpFailure('scanResult', res);
        const body = (await res.json()) as { workspaces?: Array<Record<string, unknown>> };
        const ws = body.workspaces?.[0];
        if (!ws) return { status: 'unavailable', error: 'scanResult sem workspace' };

        const bloqueio = blockedReason(ws);
        if (bloqueio) return disabledResult(bloqueio);

        const datasets = (ws.datasets ?? []) as ScannedDataset[];
        const alvo = datasets.find((d) => d.id === datasetId);
        if (!alvo) return { status: 'unavailable', error: `dataset ${datasetId} não veio no scan` };
        if (!Array.isArray(alvo.tables) || alvo.tables.length === 0) {
          return { status: 'disabled', error: 'scan voltou sem tabelas — metadados detalhados desligados' };
        }
        return { status: 'ok', data: alvo };
      } catch (err) {
        return { status: 'unavailable', error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
