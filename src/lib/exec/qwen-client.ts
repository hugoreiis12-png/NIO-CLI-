import {
  NIO_AI_BASE_URL,
  NIO_AI_MAX_INPUT,
  NIO_AI_MODEL_ID,
  NIO_AI_OUTPUT,
} from '../clients/client-configs.js';

/**
 * Cliente do Qwen vLLM local — o ÚNICO motor de delegação da CLI. Fala direto com a
 * API OpenAI-compatível (`/v1/chat/completions`), sem binário externo e sem API key.
 */

export const QWEN_ENGINE = 'qwen-3.0/vllm';

export class QwenError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'QwenError';
    this.status = status;
  }
}

export interface QwenRequestOpts {
  system?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Estimativa grosseira de tokens de input (~4 chars/token). É fail-fast, não
 * medição exata — o backend continua sendo a autoridade.
 */
export function estimateInputTokens(system: string | undefined, prompt: string): number {
  return Math.ceil(((system?.length ?? 0) + prompt.length) / 4);
}

/** Roda `prompt` no vLLM e devolve o texto de `choices[0].message.content`. */
export async function qwenComplete(
  prompt: string,
  opts: QwenRequestOpts = {},
): Promise<string> {
  if (NIO_AI_MAX_INPUT > 0) {
    const est = estimateInputTokens(opts.system, prompt);
    if (est > NIO_AI_MAX_INPUT) {
      throw new QwenError(
        `Prompt com ~${est} tokens de input excede o teto NIO_AI_MAX_INPUT=${NIO_AI_MAX_INPUT}. ` +
          `Enxugue o prompt (menos MCPs/skills no contexto) ou suba o teto via NIO_AI_MAX_INPUT.`,
      );
    }
  }
  const url = `${NIO_AI_BASE_URL.replace(/\/+$/, '')}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: NIO_AI_MODEL_ID,
        messages: [
          ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
          { role: 'user', content: prompt },
        ],
        max_tokens: opts.maxTokens ?? NIO_AI_OUTPUT,
        temperature: opts.temperature ?? 0.2,
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 500);
      throw new QwenError(`vLLM respondeu ${res.status}: ${detail}`, res.status);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new QwenError('vLLM devolveu resposta vazia');
    }
    return content;
  } catch (e) {
    if (e instanceof QwenError) throw e;
    const cause = e instanceof Error ? e.message : String(e);
    throw new QwenError(`vLLM indisponível em ${NIO_AI_BASE_URL}: ${cause}`);
  } finally {
    clearTimeout(timer);
  }
}

export interface FileBlock {
  path: string;
  content: string;
}

const FILE_BLOCK_RE = /<<<FILE\s+([^\r\n>]+)>>>\r?\n?([\s\S]*?)<<<END_FILE>>>/g;

/** Extrai blocos `<<<FILE caminho/relativo>>>` … `<<<END_FILE>>>` da resposta. */
export function parseFileBlocks(text: string): FileBlock[] {
  const blocks: FileBlock[] = [];
  for (const m of text.matchAll(FILE_BLOCK_RE)) {
    const path = m[1].trim();
    if (!path) continue;
    blocks.push({ path, content: m[2] });
  }
  return blocks;
}