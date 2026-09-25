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
import { createTokenProvider } from './token.js';

const ADMIN = 'https://api.powerbi.com/v1.0/myorg/admin/workspaces';
const POLL_MS = 2000;
const POLL_MAX = 45; // ~90s: o scan de um workspace grande leva dezenas de segundos

export type ScanStatus = 'ok' | 'unconfigured' | 'unauthorized' | 'unavailable' | 'disabled';

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

export function createFabricScanner(
  tokens: TokenProvider = createTokenProvider(),
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

  return {
    async scanDataset(workspaceId, datasetId) {
      const h = await headers();
      if (h.status !== 'ok' || !h.data) return { status: h.status, error: h.error };

      try {
        const start = await fetchImpl(
          `${ADMIN}/getInfo?datasetSchema=True&datasetExpressions=True&lineage=True`,
          { method: 'POST', headers: h.data, body: JSON.stringify({ workspaces: [workspaceId] }) },
        );
        if (!start.ok) {
          const detalhe = (await start.text().catch(() => '')).slice(0, 200);
          return { status: start.status === 401 || start.status === 403 ? 'unauthorized' : 'unavailable',
                   error: `getInfo respondeu ${start.status} ${detalhe}`.trim() };
        }
        const job = (await start.json()) as { id?: string; status?: string };
        if (!job.id) return { status: 'unavailable', error: 'getInfo sem id de scan' };

        let estado = job.status ?? '';
        for (let i = 0; i < POLL_MAX && estado !== 'Succeeded'; i++) {
          await sleep(POLL_MS);
          const s = await fetchImpl(`${ADMIN}/scanStatus/${job.id}`, { headers: h.data });
          if (!s.ok) return { status: 'unavailable', error: `scanStatus respondeu ${s.status}` };
          estado = ((await s.json()) as { status?: string }).status ?? '';
          if (estado === 'Failed') return { status: 'unavailable', error: 'scan falhou no servidor' };
        }
        if (estado !== 'Succeeded') return { status: 'unavailable', error: `scan não concluiu (${estado})` };

        const res = await fetchImpl(`${ADMIN}/scanResult/${job.id}`, { headers: h.data });
        if (!res.ok) return { status: 'unavailable', error: `scanResult respondeu ${res.status}` };
        const body = (await res.json()) as { workspaces?: Array<Record<string, unknown>> };
        const ws = body.workspaces?.[0];
        if (!ws) return { status: 'unavailable', error: 'scanResult sem workspace' };

        const bloqueio = blockedReason(ws);
        if (bloqueio) {
          return {
            status: 'disabled',
            error:
              `o locatário bloqueia os metadados (${bloqueio}). Habilite no portal admin → ` +
              'Configurações do locatário → API de administrador: "Metadados detalhados do ' +
              'conjunto de dados" e "Expressões DAX e mashup do conjunto de dados", com o ' +
              'service principal no grupo de segurança aplicado.',
          };
        }

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
