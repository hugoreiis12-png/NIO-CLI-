/**
 * Port do Power BI / Fabric REST (somente leitura). Interface pura, sem IO — o
 * adapter (`adapters/fabric`) implementa com `fetch`. Contrato de erro igual aos
 * demais ports de IO (`DockerGateway`/`OtpSender`): **nunca lança**; falha vira um
 * `FabricResult` com `status`.
 */

export interface FabricWorkspace {
  id: string;
  name: string;
}

export interface FabricDataset {
  id: string;
  name: string;
}

/** Uma linha do resultado do DAX: coluna → valor (nomes qualificados, ex. `T[Col]`). */
export type FabricRow = Record<string, unknown>;

/**
 * `ok` = sucesso; `unauthorized` = SP sem acesso ao workspace ou credencial inválida;
 * `unavailable` = Fabric fora do ar / rede; `failed` = demais erros (inclui não configurado).
 */
export type FabricStatus = 'ok' | 'unauthorized' | 'unavailable' | 'failed';

export interface FabricResult<T> {
  status: FabricStatus;
  data?: T;
  error?: string;
}

export interface FabricGateway {
  /** Lista os workspaces (grupos) visíveis ao service principal. */
  listWorkspaces(): Promise<FabricResult<FabricWorkspace[]>>;
  /** Lista os datasets (modelos semânticos) de um workspace. */
  listDatasets(workspaceId: string): Promise<FabricResult<FabricDataset[]>>;
  /**
   * Executa um DAX (`DEFINE/EVALUATE`) contra o dataset e devolve as linhas
   * (`executeQueries`). Erro de DAX (HTTP 400) vira `failed` com a mensagem, não exceção.
   */
  executeDax(workspaceId: string, datasetId: string, dax: string): Promise<FabricResult<FabricRow[]>>;
}
