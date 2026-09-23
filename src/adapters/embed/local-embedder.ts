/**
 * Embedder local (ONNX em CPU) — implementa `EmbeddingProvider` (`core/rag.ts`).
 *
 * É um **encoder**, não uma LLM: transforma texto em vetor de 768 dims pra busca
 * por similaridade. Quem gera o DAX segue sendo o Qwen no vLLM.
 *
 * Três decisões que sustentam este arquivo:
 * - **Import dinâmico com especificador em variável**: o `@huggingface/transformers`
 *   é `optionalDependency`; ausente, o CLI segue funcionando e o RAG responde
 *   `unconfigured`. A variável também evita que o `tsc` exija o módulo instalado.
 * - **Carrega uma vez por processo** (singleton) e **nunca no cold-start** — só na
 *   primeira chamada de embedding.
 * - **Prefixos do E5** (`query:` / `passage:`) são obrigatórios neste modelo;
 *   esquecê-los degrada a recuperação em silêncio.
 */
import { homePath } from '../../brand.js';
import { NIO_AI_EMBED_MODEL } from '../../lib/clients/client-configs.js';
import { EMBEDDING_DIMS, type EmbeddingProvider, type RagResult } from '../../core/rag.js';

/** Em variável: `tsc` não resolve o módulo opcional, e o Node resolve em runtime. */
const TRANSFORMERS = '@huggingface/transformers';
/** `q8` → `onnx/model_int8.onnx`: ~4x menor que o fp32, perda pequena de qualidade. */
const DTYPE = 'q8';
/** Lote da ingestão: segura o pico de RAM sem matar a vazão. */
const BATCH_SIZE = 16;

/** Superfície mínima do pacote que usamos — tipagem explícita na borda. */
interface FeatureTensor {
  tolist(): number[][];
}
type Extractor = (
  texts: string[],
  opts: { pooling: 'mean'; normalize: boolean },
) => Promise<FeatureTensor>;
interface TransformersModule {
  pipeline: (
    task: string,
    model: string,
    opts: { dtype: string; cache_dir: string },
  ) => Promise<Extractor>;
}

let cached: Extractor | null = null;

/** Repassa um resultado de ERRO para outro payload — sem arrastar o `data` alheio. */
function propagate<T>(res: RagResult<unknown>): RagResult<T> {
  return { status: res.status, error: res.error };
}

/** Mensagem acionável quando a dependência opcional não foi instalada. */
const MISSING =
  `embedder local ausente (${TRANSFORMERS} não instalado). ` +
  'Rode `nio fabric rag setup` para habilitar a busca vetorial.';

/** Carrega o modelo sob demanda. Baixa ~280MB na primeira vez, pra `~/.nio/models`. */
async function loadExtractor(): Promise<RagResult<Extractor>> {
  if (cached) return { status: 'ok', data: cached };
  try {
    const mod = (await import(TRANSFORMERS)) as TransformersModule;
    cached = await mod.pipeline('feature-extraction', NIO_AI_EMBED_MODEL, {
      dtype: DTYPE,
      cache_dir: homePath('models'),
    });
    return { status: 'ok', data: cached };
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    if (/Cannot find (module|package)|ERR_MODULE_NOT_FOUND/i.test(message)) {
      return { status: 'unconfigured', error: MISSING };
    }
    return { status: 'failed', error: `falha ao carregar o embedder: ${message}` };
  }
}

/** Confere a dimensão antes de devolver — vetor torto corrompe a coluna `vector(768)`. */
function checkDims(vectors: number[][]): RagResult<never> | null {
  const wrong = vectors.find((v) => v.length !== EMBEDDING_DIMS);
  if (!wrong) return null;
  return {
    status: 'failed',
    error: `modelo devolveu ${wrong.length} dimensões; o esquema espera ${EMBEDDING_DIMS} (modelo trocado?)`,
  };
}

/** Roda o modelo em lotes, preservando a ordem de entrada. */
async function embedAll(texts: string[]): Promise<RagResult<number[][]>> {
  if (texts.length === 0) return { status: 'ok', data: [] };
  const loaded = await loadExtractor();
  if (loaded.status !== 'ok' || !loaded.data) return propagate<number[][]>(loaded);
  try {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      // `normalize: true` deixa o vetor unitário → cosseno vira produto escalar.
      const tensor = await loaded.data(batch, { pooling: 'mean', normalize: true });
      out.push(...tensor.tolist());
    }
    return checkDims(out) ?? { status: 'ok', data: out };
  } catch (err) {
    return { status: 'failed', error: `falha ao gerar embedding: ${(err as Error).message}` };
  }
}

export function createLocalEmbedder(): EmbeddingProvider {
  return {
    async embedQuery(text) {
      const res = await embedAll([`query: ${text}`]);
      if (res.status !== 'ok') return propagate<number[]>(res);
      return { status: 'ok', data: res.data![0]! };
    },

    async embedPassages(texts) {
      return embedAll(texts.map((t) => `passage: ${t}`));
    },
  };
}

/** O embedder está instalado e carregável? Usado pelo `nio fabric rag setup`/status. */
export async function embedderStatus(): Promise<RagResult<string>> {
  const loaded = await loadExtractor();
  if (loaded.status !== 'ok') return propagate<string>(loaded);
  return { status: 'ok', data: NIO_AI_EMBED_MODEL };
}
