// Helpers comuns às tools nio_fabric_* — gateway e tradução de falha pra pt-BR.
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { FabricGateway, FabricStatus } from '../core/fabric.js';
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

/** Resolve id do arg ou do env default (workspace/dataset). */
export function orEnvDefault(fromArg: string | undefined, envKey: 'NIO_FABRIC_WORKSPACE' | 'NIO_FABRIC_DATASET'): string | undefined {
  return fromArg ?? process.env[envKey]?.trim() ?? undefined;
}
