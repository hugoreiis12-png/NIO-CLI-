/**
 * Parse de JSON vindo de LLM. Puro, sem IO.
 *
 * Três defesas contra o que o modelo realmente devolve, não contra o que ele
 * deveria devolver: cerca de markdown (```json), texto de cortesia antes/depois
 * do JSON, e shape divergente do combinado. As duas primeiras são cosméticas; a
 * terceira é a que importa, e é por isso que o schema é obrigatório.
 */
import type { ZodType } from 'zod';
import { stripFence } from '../lib/exec/plan-delegate.js';

export class LlmJsonError extends Error {
  constructor(
    motivo: string,
    readonly bruto: string,
  ) {
    // O bruto vai truncado: resposta de LLM cabe em log, não em mensagem de erro.
    super(`${motivo} Resposta: ${bruto.slice(0, 200)}`);
    this.name = 'LlmJsonError';
  }
}

/**
 * Recorta o primeiro JSON balanceado do texto. O modelo às vezes prefacia com
 * "Claro, aqui está:" — exigir a resposta limpa custaria um retry por educação.
 */
function recortarJson(texto: string): string {
  const inicio = texto.search(/[[{]/);
  if (inicio < 0) return texto;
  const abre = texto[inicio] === '[' ? '[' : '{';
  const fecha = abre === '[' ? ']' : '}';
  const fim = texto.lastIndexOf(fecha);
  return fim > inicio ? texto.slice(inicio, fim + 1) : texto;
}

/** Aplica `schema` ao JSON da resposta. Lança `LlmJsonError` com o bruto anexado. */
export function parseLlmJson<T>(resposta: string, schema: ZodType<T>): T {
  const texto = recortarJson(stripFence(resposta));
  let cru: unknown;
  try {
    cru = JSON.parse(texto);
  } catch {
    throw new LlmJsonError('O modelo não devolveu JSON válido.', resposta);
  }
  const parsed = schema.safeParse(cru);
  if (!parsed.success) {
    throw new LlmJsonError(`JSON fora do formato esperado (${parsed.error.message}).`, resposta);
  }
  return parsed.data;
}
