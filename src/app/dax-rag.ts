/**
 * Orquestrador do RAG de DAX — os **três níveis**, do mais barato ao mais caro:
 *
 *   0. REPLAY   — `question_hash` bate (mesma pergunta normalizada + mesmo dataset).
 *                 Executa o DAX guardado literal. Seguro por construção.
 *   1. ADAPTA   — vizinho por cosseno ≥ limiar. O template é **base**, não resposta:
 *                 o modelo ajusta os parâmetros. Pula a busca na documentação.
 *   2. GERA     — abaixo do limiar. Contexto da doc + geração completa.
 *
 * **Invariante que este módulo protege:** um template achado por *similaridade* NUNCA
 * é executado sem adaptação. Medimos que perguntas erradas (ano/métrica/dimensão
 * diferentes) pontuam 0,955–0,965 — acima de paráfrases legítimas (0,928). E o Fabric
 * valida sintaxe, não intenção: o DAX de "compras" roda e devolve números errados em
 * silêncio. Só o hit por hash replica.
 *
 * Tudo injetado (`DaxRagDeps`) — testável sem banco, sem modelo e sem rede.
 */
import type { FabricGateway, FabricRow } from '../core/fabric.js';
import type { DaxMemory, EmbeddingProvider, RagResult, ScoredTemplate } from '../core/rag.js';
import { NIO_FABRIC_RAG_TEMPLATE_MIN } from '../lib/clients/client-configs.js';
import { normalizeQuestion, summarizeOutput } from './rag-templates.js';

/** Por onde a resposta veio — alimenta métricas de hit/miss por nível. */
export type DaxTier = 'replay' | 'adapted' | 'generated';

export interface DaxAnswer {
  tier: DaxTier;
  dax: string;
  rows: FabricRow[];
  /** Template que originou a resposta (níveis 0 e 1). */
  templateId?: number;
  /** Score que trouxe o template no nível 1 (ausente no replay, que é exato). */
  score?: number;
}

/** Pedido de geração/adaptação ao modelo. `template` presente = adaptar, não criar. */
export interface GenerateRequest {
  question: string;
  workspaceId: string;
  datasetId: string;
  /** Nível 1: DAX validado de uma pergunta parecida — ajustar os parâmetros. */
  template?: { dax: string; questionNorm: string };
  /** Nível 2: trechos da documentação para grounding. */
  docs?: string[];
  /** Retry: o erro legível da tentativa anterior. */
  previousError?: string;
  /** Retry: o DAX que falhou. Sem ele o modelo corrige às cegas o que não vê. */
  previousDax?: string;
}

export type DaxGenerator = (req: GenerateRequest) => Promise<RagResult<string>>;

export interface DaxRagDeps {
  memory: DaxMemory;
  embedder: EmbeddingProvider;
  fabric: FabricGateway;
  generate: DaxGenerator;
  /** Busca na documentação (Nível 2). Ausente = gera sem grounding. */
  searchDocs?: (embedding: number[]) => Promise<RagResult<string[]>>;
  /** Limiar do nível 1. Default vem da config. */
  templateMin?: number;
}

export interface AskInput {
  question: string;
  workspaceId: string;
  datasetId: string;
  /** Nome curto da request, guardado no template. Default: a pergunta normalizada. */
  requestName?: string;
}

/** Repassa um erro para outro payload sem arrastar `data` alheio. */
function propagate<T>(res: RagResult<unknown>): RagResult<T> {
  return { status: res.status, error: res.error };
}

/**
 * Executa o DAX e, em caso de 400 legível, deixa o modelo tentar **uma** vez com o erro
 * no prompt. Sem isso o retry seria cego — foi pra isso que o `daxErrorFrom` passou a
 * surfacear o `pbi.error.details[]`.
 */
async function runWithRetry(
  deps: DaxRagDeps,
  input: AskInput,
  dax: string,
  request: GenerateRequest,
): Promise<RagResult<{ dax: string; rows: FabricRow[] }>> {
  const first = await deps.fabric.executeDax(input.workspaceId, input.datasetId, dax);
  if (first.status === 'ok') return { status: 'ok', data: { dax, rows: first.data ?? [] } };

  // Só erro de DAX merece nova tentativa; falta de permissão ou rede não melhora repetindo.
  if (first.status !== 'failed') return { status: 'unavailable', error: first.error };

  // Retry enxuto: o grounding já foi usado e não impediu o erro — reenviá-lo só
  // duplica token. O que o modelo precisa é ver **o próprio DAX que falhou** e o motivo.
  const retry = await deps.generate({
    ...request,
    docs: undefined,
    previousDax: dax,
    previousError: first.error,
  });
  if (retry.status !== 'ok' || !retry.data) {
    return { status: 'failed', error: first.error };
  }
  const second = await deps.fabric.executeDax(input.workspaceId, input.datasetId, retry.data);
  if (second.status === 'ok') return { status: 'ok', data: { dax: retry.data, rows: second.data ?? [] } };
  return { status: 'failed', error: second.error ?? first.error };
}

/** Grava o template após execução bem-sucedida (write-back). Falha aqui não derruba a resposta. */
async function rememberSuccess(
  deps: DaxRagDeps,
  input: AskInput,
  questionNorm: string,
  dax: string,
  rows: FabricRow[],
  embedding: number[] | null,
): Promise<number | undefined> {
  if (!embedding) return undefined;
  const saved = await deps.memory.remember(
    {
      requestName: input.requestName ?? questionNorm,
      questionNorm,
      workspaceId: input.workspaceId,
      datasetId: input.datasetId,
      dax,
      outputSummary: summarizeOutput(rows),
    },
    embedding,
  );
  return saved.status === 'ok' ? saved.data : undefined;
}

/**
 * Responde uma pergunta em linguagem natural com dados do Fabric, percorrendo os três
 * níveis. Nunca lança — falha vira `RagResult`.
 */
export async function askDax(deps: DaxRagDeps, input: AskInput): Promise<RagResult<DaxAnswer>> {
  const questionNorm = normalizeQuestion(input.question);
  const baseRequest: GenerateRequest = {
    question: input.question,
    workspaceId: input.workspaceId,
    datasetId: input.datasetId,
  };

  // ── Nível 0: hit exato por hash → replay literal ──────────────────────────
  const exact = await deps.memory.findByQuestion(questionNorm, input.workspaceId, input.datasetId);
  if (exact.status === 'ok' && exact.data) {
    const run = await deps.fabric.executeDax(input.workspaceId, input.datasetId, exact.data.dax);
    if (run.status === 'ok') {
      await deps.memory.markHit(exact.data.id);
      return {
        status: 'ok',
        data: { tier: 'replay', dax: exact.data.dax, rows: run.data ?? [], templateId: exact.data.id },
      };
    }
    // Template envelheceu (modelo mudou): cai pros níveis seguintes em vez de falhar.
  }

  // ── Embedding: necessário do nível 1 em diante ────────────────────────────
  const embedded = await deps.embedder.embedQuery(input.question);
  if (embedded.status !== 'ok' || !embedded.data) return propagate<DaxAnswer>(embedded);
  const embedding = embedded.data;

  // ── Nível 1: vizinho parecido → ADAPTA (nunca replica) ────────────────────
  const min = deps.templateMin ?? NIO_FABRIC_RAG_TEMPLATE_MIN;
  const similar = await deps.memory.findSimilar(embedding, input.workspaceId, input.datasetId, min);
  const template: ScoredTemplate | null = similar.status === 'ok' ? (similar.data ?? null) : null;

  if (template) {
    const request: GenerateRequest = {
      ...baseRequest,
      template: { dax: template.dax, questionNorm: template.questionNorm },
    };
    const adapted = await deps.generate(request);
    // Geração falhou: NÃO cai pro DAX do template (seria o falso positivo). Segue pro nível 2.
    if (adapted.status === 'ok' && adapted.data) {
      const run = await runWithRetry(deps, input, adapted.data, request);
      if (run.status === 'ok' && run.data) {
        const id = await rememberSuccess(deps, input, questionNorm, run.data.dax, run.data.rows, embedding);
        return {
          status: 'ok',
          data: {
            tier: 'adapted',
            dax: run.data.dax,
            rows: run.data.rows,
            templateId: id ?? template.id,
            score: template.score,
          },
        };
      }
    }
  }

  // ── Nível 2: documentação + geração completa ──────────────────────────────
  const docs = deps.searchDocs ? await deps.searchDocs(embedding) : null;
  const request: GenerateRequest = {
    ...baseRequest,
    docs: docs?.status === 'ok' ? docs.data : undefined,
  };
  const generated = await deps.generate(request);
  if (generated.status !== 'ok' || !generated.data) return propagate<DaxAnswer>(generated);

  const run = await runWithRetry(deps, input, generated.data, request);
  if (run.status !== 'ok' || !run.data) return propagate<DaxAnswer>(run);

  const id = await rememberSuccess(deps, input, questionNorm, run.data.dax, run.data.rows, embedding);
  return {
    status: 'ok',
    data: { tier: 'generated', dax: run.data.dax, rows: run.data.rows, templateId: id },
  };
}
