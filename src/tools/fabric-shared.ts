// Helpers comuns às tools nio_fabric_* — gateway e tradução de falha pra pt-BR.
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { FabricGateway, FabricRow, FabricStatus } from '../core/fabric.js';
import { NIO_FABRIC_MAX_ROWS, NIO_FABRIC_MAX_ROW_CHARS } from '../lib/clients/client-configs.js';
import { createFabricGateway } from '../adapters/fabric/client.js';
import { errorResult } from '../lib/tool-result.js';

/** Gateway do Fabric (SP via env). Seam opcional pra teste. */
export function fabricGateway(): FabricGateway {
  return createFabricGateway();
}

const FABRIC_ERROR_LABEL: Record<Exclude<FabricStatus, 'ok'>, string> = {
  unauthorized: 'Sem acesso ao Fabric (service principal sem permissão, RLS/SSO no dataset, ou credencial inválida)',
  unavailable: 'Fabric indisponível (rede/timeout)',
  failed: 'Falha na consulta ao Fabric',
};

/** Traduz um `FabricResult` de falha num `errorResult` pt-BR. */
export function fabricErrorResult(status: Exclude<FabricStatus, 'ok'>, error?: string): CallToolResult {
  return errorResult(`${FABRIC_ERROR_LABEL[status]}: ${error ?? 'sem detalhe'}`);
}

/**
 * Projeta uma listagem para `{id, name}` — o único par que o agente usa pra navegar.
 *
 * O adapter repassa o OData cru (`items.push(...json.value)`), e isso ia inteiro pro
 * contexto: 14 campos por dataset, incluindo `webUrl`, `createReportEmbedURL` e
 * `qnaEmbedURL`. Medido: 6 datasets = 1.588 tokens crus contra 118 projetados (−93%);
 * 25 workspaces = 942 contra 449 (−52%).
 *
 * De quebra, faz o runtime honrar os tipos declarados em `core/fabric.ts`.
 */
export function leanList(items: readonly { id: string; name: string }[]): { id: string; name: string }[] {
  return items.map(({ id, name }) => ({ id, name }));
}

/**
 * Aplica o teto de linhas. O `row_count` devolvido é **sempre o real** — só a lista é
 * cortada — e a truncagem vem com a instrução do que fazer no lugar de varrer.
 */
export function capRows(rows: FabricRow[]): {
  rows: FabricRow[];
  row_count: number;
  truncado?: string;
} {
  const out: FabricRow[] = [];
  let chars = 0;
  for (const row of rows) {
    if (out.length >= NIO_FABRIC_MAX_ROWS) break;
    const size = JSON.stringify(row).length;
    // A 1ª linha entra sempre, mesmo gigante: devolver zero linha seria pior.
    if (out.length > 0 && chars + size > NIO_FABRIC_MAX_ROW_CHARS) break;
    out.push(row);
    chars += size;
  }
  if (out.length === rows.length) return { rows, row_count: rows.length };
  return {
    rows: out,
    row_count: rows.length,
    truncado:
      `mostrando ${out.length} de ${rows.length} linhas. Para o total, agregue no ` +
      `próprio DAX (SUMMARIZECOLUMNS/TOPN/COUNTROWS) em vez de varrer a tabela.`,
  };
}

/** Resolve id do arg ou do env default (workspace/dataset). */
export function orEnvDefault(fromArg: string | undefined, envKey: 'NIO_FABRIC_WORKSPACE' | 'NIO_FABRIC_DATASET'): string | undefined {
  return fromArg ?? process.env[envKey]?.trim() ?? undefined;
}
