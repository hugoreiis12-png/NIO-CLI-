/**
 * Ingestão do schema do modelo semântico no índice vetorial: lê via `INFO.VIEW.*`
 * (REST, sem XMLA), chunka, embeda e grava. É o grounding que impede o modelo de
 * inventar nome de tabela — a causa real dos 400 que depuramos.
 *
 * Idempotente: o `ref` é o hash do conteúdo, então reingerir um schema inalterado
 * não escreve nada e nem gasta embedding.
 */
import type { FabricGateway, FabricRow } from '../core/fabric.js';
import type { DocIndex, EmbeddingProvider, RagResult } from '../core/rag.js';
import { buildSchemaChunks, schemaRepo, type SchemaRows } from './schema-chunker.js';
import { scanToSchemaRows } from './scan-to-schema.js';
import type { FabricScanner } from '../adapters/fabric/scanner.js';

/**
 * `INFO.VIEW.*` (e não `INFO.*`): medimos que a forma sem `VIEW` devolve 400 neste
 * tenant. Só as três que interessam pro vocabulário do modelo.
 */
const SCHEMA_QUERIES = {
  tables: 'EVALUATE INFO.VIEW.TABLES()',
  measures: 'EVALUATE INFO.VIEW.MEASURES()',
  columns: 'EVALUATE INFO.VIEW.COLUMNS()',
} as const;

export interface SchemaIngestDeps {
  fabric: FabricGateway;
  embedder: EmbeddingProvider;
  index: DocIndex;
  /**
   * Scanner admin — a ÚNICA rota que entrega a fórmula das medidas (o `INFO.VIEW`
   * devolve `[Expression]` nulo, medido em 381 de 381). Opcional: sem ele, ou com os
   * toggles do locatário desligados, cai no `INFO.VIEW` e o grounding segue sem fórmula.
   */
  scanner?: FabricScanner;
}

export interface SchemaIngestInput {
  workspaceId: string;
  datasetId: string;
  /** Reingere mesmo se o `ref` já estiver indexado. */
  force?: boolean;
}

export interface SchemaIngestReport {
  tables: number;
  measures: number;
  chunks: number;
  inserted: number;
  ref: string;
  /** `true` = schema inalterado, nada foi reembedado. */
  unchanged: boolean;
}

function propagate<T>(res: RagResult<unknown>): RagResult<T> {
  return { status: res.status, error: res.error };
}

/** Lê as três consultas de schema. Qualquer falha aborta — meio schema é pior que nenhum. */
async function readSchema(
  fabric: FabricGateway,
  workspaceId: string,
  datasetId: string,
): Promise<RagResult<{ tables: FabricRow[]; measures: FabricRow[]; columns: FabricRow[] }>> {
  const out: Record<string, FabricRow[]> = {};
  for (const [key, dax] of Object.entries(SCHEMA_QUERIES)) {
    const res = await fabric.executeDax(workspaceId, datasetId, dax);
    if (res.status !== 'ok') {
      return {
        status: res.status === 'unauthorized' ? 'failed' : 'unavailable',
        error: `falha lendo ${key} do modelo: ${res.error ?? 'sem detalhe'}`,
      };
    }
    out[key] = res.data ?? [];
  }
  return {
    status: 'ok',
    data: { tables: out.tables!, measures: out.measures!, columns: out.columns! },
  };
}

/**
 * Tenta o scanner (traz fórmula); qualquer problema dele cai no `INFO.VIEW`, que sempre
 * funciona mas vem sem fórmula. Degradar em silêncio seria errado — quem quer saber por
 * que não há fórmula usa `nio fabric rag status`.
 */
async function readSchemaPreferindoScanner(
  deps: SchemaIngestDeps,
  input: SchemaIngestInput,
): Promise<RagResult<SchemaRows>> {
  if (deps.scanner) {
    const scan = await deps.scanner.scanDataset(input.workspaceId, input.datasetId);
    if (scan.status === 'ok' && scan.data) return { status: 'ok', data: scanToSchemaRows(scan.data) };
  }
  return readSchema(deps.fabric, input.workspaceId, input.datasetId);
}

/**
 * Sincroniza o schema do modelo para o índice vetorial. Devolve o relatório pro CLI
 * imprimir. Nunca lança.
 */
export async function ingestSchema(
  deps: SchemaIngestDeps,
  input: SchemaIngestInput,
): Promise<RagResult<SchemaIngestReport>> {
  const schema = await readSchemaPreferindoScanner(deps, input);
  if (schema.status !== 'ok' || !schema.data) return propagate<SchemaIngestReport>(schema);

  const chunks = buildSchemaChunks(schema.data, input.datasetId);
  const ref = chunks[0]?.ref ?? '';
  const repo = schemaRepo(input.datasetId);
  const base = {
    tables: schema.data.tables.length,
    measures: schema.data.measures.length,
    chunks: chunks.length,
    ref,
  };

  // Schema inalterado → o ref já está indexado → não reembeda (o caro é o embedding).
  if (!input.force) {
    const known = await deps.index.indexedRefs(repo);
    if (known.status === 'ok' && (known.data ?? []).includes(ref)) {
      return { status: 'ok', data: { ...base, inserted: 0, unchanged: true } };
    }
  }

  const embedded = await deps.embedder.embedPassages(chunks.map((c) => c.content));
  if (embedded.status !== 'ok' || !embedded.data) return propagate<SchemaIngestReport>(embedded);

  const saved = await deps.index.indexChunks(chunks, embedded.data);
  if (saved.status !== 'ok') return propagate<SchemaIngestReport>(saved);

  return { status: 'ok', data: { ...base, inserted: saved.data ?? 0, unchanged: false } };
}
