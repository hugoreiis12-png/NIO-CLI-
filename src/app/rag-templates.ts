/**
 * Núcleo puro do cache semântico de DAX: normalização da pergunta, chave de hit
 * exato e resumo barato da saída. Sem IO — o orquestrador (`dax-rag.ts`) e o
 * repository (`adapters/pg`) consomem daqui. Testável sem banco nem modelo.
 */
import { createHash } from 'node:crypto';
import type { FabricRow } from '../core/fabric.js';
import type { DaxOutputSummary } from '../core/rag.js';

/** Linhas da amostra guardadas no template — o suficiente pra dar forma à resposta. */
const SAMPLE_ROWS = 3;
/** Teto por célula da amostra: evita guardar um blob de texto dentro do resumo. */
const MAX_CELL_CHARS = 200;

/**
 * Forma canônica da pergunta para o hit exato: minúsculas, sem acento, espaços
 * colapsados e sem pontuação final. "Qual o Total de Vendas?" e "qual o total de
 * vendas" viram a mesma chave — sem tocar a semântica.
 */
export function normalizeQuestion(question: string): string {
  return question
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove diacríticos
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim() // antes de cortar a pontuação: senão "vendas!!  " não casa o fim de string
    .replace(/[?!.,;:]+$/, '')
    .trim();
}

/**
 * Chave do hit exato. Inclui o escopo porque **o mesmo texto em outro modelo
 * semântico é outra pergunta** — um DAX válido num dataset é inválido noutro.
 */
export function questionHash(questionNorm: string, workspaceId: string, datasetId: string): string {
  return createHash('sha256').update(`${workspaceId}\u0000${datasetId}\u0000${questionNorm}`).digest('hex');
}

/** Corta valores longos da amostra; preserva o tipo quando não é string. */
function clampCell(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return value.length > MAX_CELL_CHARS ? `${value.slice(0, MAX_CELL_CHARS)}…` : value;
}

/**
 * Resumo do resultado para guardar no template: contagem, colunas e uma amostra
 * curta. **Nunca o resultado inteiro** — o template existe para ser leve.
 */
export function summarizeOutput(rows: FabricRow[], sampleRows = SAMPLE_ROWS): DaxOutputSummary {
  const columns = rows.length > 0 ? Object.keys(rows[0]!) : [];
  const sample = rows.slice(0, sampleRows).map((row) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) out[key] = clampCell(value);
    return out;
  });
  return { rowCount: rows.length, columns, sample };
}

/**
 * O vizinho recuperado é confiável o bastante para reusar o DAX? Limiar vem da
 * config (não fixo em 0.9) — abaixo dele o caminho completo de geração é mais barato
 * que servir a consulta errada.
 */
export function isCacheHit(score: number, threshold: number): boolean {
  return Number.isFinite(score) && score >= threshold;
}
