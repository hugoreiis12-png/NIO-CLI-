/**
 * Ports do RAG vetorial de consultas DAX. Interfaces puras, sem IO — os adapters
 * implementam (`adapters/embed` com ONNX local, `adapters/pg` com pgvector).
 * Contrato de erro igual aos demais ports de IO (`FabricGateway`/`DockerGateway`):
 * **nunca lançam**; falha vira um resultado com `status`.
 *
 * Dois acervos, papéis distintos:
 * - `DocIndex`   → documentação oficial vendorizada (grounding da geração).
 * - `DaxMemory`  → templates de consultas que **deram certo** (cache semântico).
 */

/** Dimensão do embedding — casada com `multilingual-e5-base` e com a coluna `vector(768)`. */
export const EMBEDDING_DIMS = 768;

/**
 * `ok` = sucesso; `unavailable` = modelo/banco fora do ar; `unconfigured` = embedder
 * não instalado (optionalDependency ausente); `failed` = demais erros.
 */
export type RagStatus = 'ok' | 'unavailable' | 'unconfigured' | 'failed';

export interface RagResult<T> {
  status: RagStatus;
  data?: T;
  error?: string;
}

/**
 * Gera embeddings. Modelos E5 exigem prefixo distinto para pergunta e documento
 * (`query:` / `passage:`) — quem implementa aplica; quem chama não precisa saber.
 */
export interface EmbeddingProvider {
  /** Embedding de uma **pergunta** (prefixo `query:`). */
  embedQuery(text: string): Promise<RagResult<number[]>>;
  /** Embeddings de **documentos** em lote (prefixo `passage:`), na ordem recebida. */
  embedPassages(texts: string[]): Promise<RagResult<number[][]>>;
}

/** Um chunk de documentação já indexado. */
export interface DocChunk {
  repo: string;
  ref: string;
  path: string;
  heading?: string;
  content: string;
}

/** Chunk recuperado por similaridade, com o score de proximidade (1 = idêntico). */
export interface ScoredChunk extends DocChunk {
  score: number;
}

/** Acervo de documentação: ingestão idempotente + recuperação por similaridade. */
export interface DocIndex {
  /** Grava os chunks (ignora os já presentes por `repo+ref+path+hash`). Devolve quantos entraram. */
  indexChunks(chunks: DocChunk[], embeddings: number[][]): Promise<RagResult<number>>;
  /** Top-k por similaridade de cosseno. */
  search(embedding: number[], topK: number): Promise<RagResult<ScoredChunk[]>>;
  /** Refs já indexados de um repo — evita reingerir o mesmo SHA. */
  indexedRefs(repo: string): Promise<RagResult<string[]>>;
}

/**
 * O template simplificado do cache. Guarda o **essencial para replicar** a consulta,
 * não a request nem o resultado inteiros: nome da request, o DAX que funcionou e um
 * resumo da saída.
 */
export interface DaxTemplate {
  requestName: string;
  questionNorm: string;
  workspaceId: string;
  datasetId: string;
  dax: string;
  outputSummary: DaxOutputSummary;
}

/** Resumo barato da saída — nunca o resultado completo (evita inchar o banco). */
export interface DaxOutputSummary {
  rowCount: number;
  columns: string[];
  /** Amostra curta das primeiras linhas, só para dar forma à resposta. */
  sample: Record<string, unknown>[];
}

/** Template recuperado, com o score que o trouxe. */
export interface ScoredTemplate extends DaxTemplate {
  id: number;
  score: number;
}

/**
 * Memória de consultas validadas. O escopo (`workspaceId`/`datasetId`) é parte da
 * busca: um DAX só vale no modelo semântico em que nasceu.
 */
export interface DaxMemory {
  /** Hit exato pela pergunta normalizada — sem custo de vetor. */
  findByQuestion(
    questionNorm: string,
    workspaceId: string,
    datasetId: string,
  ): Promise<RagResult<ScoredTemplate | null>>;
  /** Vizinho mais próximo acima de `minScore`, dentro do escopo. */
  findSimilar(
    embedding: number[],
    workspaceId: string,
    datasetId: string,
    minScore: number,
  ): Promise<RagResult<ScoredTemplate | null>>;
  /** Grava (ou atualiza) o template após uma execução bem-sucedida. */
  remember(template: DaxTemplate, embedding: number[]): Promise<RagResult<number>>;
  /** Contabiliza o reuso — alimenta métricas de hit/miss. */
  markHit(id: number): Promise<RagResult<void>>;
}
