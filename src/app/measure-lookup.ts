/**
 * Lê o chunk de medida do acervo e devolve os campos estruturados. Puro: sem IO.
 *
 * O chunk tem a forma que o `schema-chunker` grava:
 *   Medida: <nome>
 *   Tabela: <tabela>
 *   Expressão DAX: <fórmula>
 */

export interface MeasureInfo {
  nome: string;
  tabela?: string;
  formula?: string;
  descricao?: string;
}

/** Valor de uma linha `Rótulo: valor`, ou `undefined`. */
function campo(linhas: readonly string[], rotulo: string): string | undefined {
  const i = linhas.findIndex((l) => l.startsWith(`${rotulo}:`));
  if (i < 0) return undefined;
  // A fórmula pode ter várias linhas: tudo até o próximo rótulo conhecido pertence a ela.
  const resto = linhas.slice(i + 1);
  const fim = resto.findIndex((l) => /^(Medida|Tabela|Tipo|Pasta|Descrição|Expressão DAX):/.test(l));
  const extra = (fim < 0 ? resto : resto.slice(0, fim)).join('\n').trim();
  const primeira = linhas[i]!.slice(rotulo.length + 1).trim();
  return extra ? `${primeira}\n${extra}`.trim() : primeira || undefined;
}

export function parseMeasureChunk(chunk: string): MeasureInfo | null {
  const linhas = chunk.split('\n');
  const nome = campo(linhas, 'Medida');
  if (!nome) return null;
  return {
    nome,
    tabela: campo(linhas, 'Tabela'),
    formula: campo(linhas, 'Expressão DAX'),
    descricao: campo(linhas, 'Descrição'),
  };
}

export function parseMeasureChunks(chunks: readonly string[]): MeasureInfo[] {
  return chunks.map(parseMeasureChunk).filter((m): m is MeasureInfo => m !== null);
}
