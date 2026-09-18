/**
 * Map-reduce de input grande: quando o texto do usuário passa do teto, quebra em
 * chunks, resume cada um (map) e junta (reduce), recursivamente até caber — assim
 * mesmo uma entrada enorme chega compactada ao provider. É **lossy** (resumo) e
 * custa chamadas LLM extras. Motor = `qwenComplete` (vLLM direto), injetável p/ teste.
 */
import { NIO_AI_MAX_INPUT, NIO_AI_MAPREDUCE_THRESHOLD } from '../clients/client-configs.js';
import { qwenComplete, estimateInputTokens, type QwenRequestOpts } from './qwen-client.js';
import { stripFence } from './plan-delegate.js';

const COMPACT_PROMPT =
  'Você compacta trechos para caberem no contexto de um assistente. Resuma o trecho ' +
  'preservando decisões, fatos, arquivos, código e estado que importam adiante. Seja ' +
  'factual e conciso; não invente nada. Devolva SÓ o resumo, sem preâmbulo.';

/** Margem sobre o system prompt do resumo — o chunk fica abaixo disso, não do teto cru. */
const CHUNK_MARGIN_TOKENS = 512;
const DEFAULT_MAX_DEPTH = 3;

export interface CompactDeps {
  /** Motor de resumo (default `qwenComplete`). Injetável p/ teste. */
  complete?: (prompt: string, opts?: QwenRequestOpts) => Promise<string>;
  /** Teto acima do qual compacta (default `NIO_AI_MAPREDUCE_THRESHOLD`). */
  threshold?: number;
  /** Teto de tokens por chunk (default `NIO_AI_MAX_INPUT - margem`). */
  maxChunkTokens?: number;
  /** Cap de recursão do reduce (default 3) — guard anti-loop. */
  maxDepth?: number;
  /** Callback de progresso (nº de chunks nesta passada), p/ UX. */
  onProgress?: (chunks: number) => void;
}

/** `true` se o texto excede o teto de tokens estimado. */
function exceeds(text: string, threshold: number): boolean {
  return threshold > 0 && estimateInputTokens(undefined, text) > threshold;
}

/**
 * Quebra `text` em pedaços com no máximo ~`maxTokens` cada, respeitando fronteiras
 * (parágrafo, senão linha, senão corte duro por tamanho). Puro.
 */
export function chunkByTokens(text: string, maxTokens: number): string[] {
  const budget = Math.max(1, maxTokens) * 4; // ~4 chars/token (mesma base do estimate)
  const chunks: string[] = [];
  let cur = '';
  for (const unit of splitUnits(text)) {
    if (cur && cur.length + unit.length > budget) {
      chunks.push(cur);
      cur = '';
    }
    cur = cur ? cur + unit : unit;
    while (cur.length > budget) {
      chunks.push(cur.slice(0, budget));
      cur = cur.slice(budget);
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/** Unidades de quebra: parágrafos (mantendo o separador); cai pra linhas se preciso. */
function splitUnits(text: string): string[] {
  const paras = text.split(/(\n\s*\n)/);
  return paras.length > 1 ? paras : text.split(/(?<=\n)/);
}

/**
 * Compacta `text` por map-reduce se exceder o teto; senão devolve intacto. Recorre no
 * resultado combinado até caber ou bater `maxDepth`. Nunca engole erro do `complete`.
 */
export async function compactInput(text: string, deps: CompactDeps = {}): Promise<string> {
  const complete = deps.complete ?? qwenComplete;
  const threshold = deps.threshold ?? NIO_AI_MAPREDUCE_THRESHOLD;
  const maxChunk = deps.maxChunkTokens ?? Math.max(1, NIO_AI_MAX_INPUT - CHUNK_MARGIN_TOKENS);
  const maxDepth = deps.maxDepth ?? DEFAULT_MAX_DEPTH;

  if (!exceeds(text, threshold)) return text;

  let current = text;
  for (let depth = 0; depth < maxDepth && exceeds(current, threshold); depth++) {
    const chunks = chunkByTokens(current, maxChunk);
    deps.onProgress?.(chunks.length);
    if (chunks.length <= 1) break; // não dá pra reduzir mais (guard anti-loop)
    const summaries: string[] = [];
    for (const chunk of chunks) {
      summaries.push(stripFence(await complete(chunk, { system: COMPACT_PROMPT })).trim());
    }
    current = summaries.join('\n\n');
  }
  return current;
}
