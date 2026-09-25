/**
 * Converte o payload do scanner admin na mesma forma que o `INFO.VIEW.*` produz.
 *
 * De propósito: `buildSchemaChunks` e tudo o que vem depois continuam iguais. A única
 * diferença visível é que agora a medida chega **com a fórmula** — que era o dado que
 * faltava e o motivo de existir esta rota.
 *
 * Puro: sem IO.
 */
import type { FabricRow } from '../core/fabric.js';
import type { SchemaRows } from './schema-chunker.js';
import type { ScannedDataset } from '../adapters/fabric/scanner.js';

/** O `INFO.VIEW.*` devolve as colunas entre colchetes; o chunker lê nesse formato. */
const cell = (v: unknown): string | null => (v === undefined || v === null ? null : String(v));

export function scanToSchemaRows(dataset: ScannedDataset): SchemaRows {
  const tables: FabricRow[] = [];
  const measures: FabricRow[] = [];
  const columns: FabricRow[] = [];

  for (const t of dataset.tables ?? []) {
    tables.push({
      '[Name]': t.name,
      '[IsHidden]': String(Boolean(t.isHidden)),
      '[StorageMode]': cell(t.storageMode),
      '[Description]': null,
    });

    for (const c of t.columns ?? []) {
      columns.push({
        '[Table]': t.name,
        '[Name]': c.name,
        '[DataType]': cell(c.dataType),
        '[IsHidden]': String(Boolean(c.isHidden)),
      });
    }

    for (const m of t.measures ?? []) {
      measures.push({
        '[Table]': t.name,
        '[Name]': m.name,
        '[IsHidden]': String(Boolean(m.isHidden)),
        '[Description]': cell(m.description),
        // O ponto da rota inteira: a definição da medida, que o INFO.VIEW não entrega.
        '[Expression]': cell(m.expression),
        '[DataType]': null,
        '[DisplayFolder]': null,
      });
    }
  }

  return { tables, measures, columns };
}

/** Quantas medidas vieram com fórmula — o número que o `rag status` reporta. */
export function countWithExpression(rows: SchemaRows): { total: number; comFormula: number } {
  const total = rows.measures.length;
  const comFormula = rows.measures.filter((m) => {
    const e = m['[Expression]'];
    return e !== null && e !== undefined && String(e).trim() !== '';
  }).length;
  return { total, comFormula };
}
