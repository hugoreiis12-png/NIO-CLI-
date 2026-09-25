import { test, expect } from 'bun:test';
import { scanToSchemaRows, countWithExpression } from './scan-to-schema.js';
import { buildSchemaChunks } from './schema-chunker.js';
import type { ScannedDataset } from '../adapters/fabric/scanner.js';

// Forma REAL observada no payload do scanner (2026-09-25).
const SCAN: ScannedDataset = {
  id: 'ds1',
  name: 'COMERCIAL',
  tables: [
    {
      name: 'VISAO_COMERCIAL',
      isHidden: false,
      storageMode: 'Import',
      columns: [
        { name: 'data_lancamento', dataType: 'DateTime', isHidden: false },
        { name: 'total_linha', dataType: 'Double', isHidden: false },
      ],
      measures: [
        { name: 'TOTAL_DEV_PAGA', expression: 'CALCULATE(SUM(VISAO_COMERCIAL[total_linha]))' },
        { name: 'OCULTA', expression: 'X', isHidden: true },
      ],
    },
    { name: 'LocalDateTable_x', isHidden: true, columns: [], measures: [] },
  ],
};

test('ACEITE: a medida chega COM a fórmula — era o dado que faltava', () => {
  const rows = scanToSchemaRows(SCAN);
  const m = rows.measures.find((x) => x['[Name]'] === 'TOTAL_DEV_PAGA')!;
  expect(m['[Expression]']).toContain('CALCULATE(SUM(VISAO_COMERCIAL[total_linha]))');
});

test('ACEITE: a saída é a MESMA forma do INFO.VIEW — nada a jusante muda', () => {
  // O chunker consome sem saber de onde veio; é o que mantém o raio de impacto pequeno.
  const chunks = buildSchemaChunks(scanToSchemaRows(SCAN), 'ds1');
  const medida = chunks.find((c) => c.path.startsWith('medida/'))!;
  expect(medida.content).toContain('Medida: TOTAL_DEV_PAGA');
  expect(medida.content).toContain('Expressão DAX: CALCULATE');
});

test('coluna sai com tabela e tipo, como o chunker espera', () => {
  const rows = scanToSchemaRows(SCAN);
  const c = rows.columns.find((x) => x['[Name]'] === 'data_lancamento')!;
  expect(c['[Table]']).toBe('VISAO_COMERCIAL');
  expect(c['[DataType]']).toBe('DateTime');
});

test('isHidden vira string — o chunker compara com "true"', () => {
  const rows = scanToSchemaRows(SCAN);
  expect(rows.measures.find((m) => m['[Name]'] === 'OCULTA')!['[IsHidden]']).toBe('true');
  const chunks = buildSchemaChunks(rows, 'ds1');
  expect(chunks.some((c) => c.path.includes('OCULTA'))).toBe(false); // oculta não entra
});

test('tabela auto-gerada do Power BI é descartada pelo chunker', () => {
  const chunks = buildSchemaChunks(scanToSchemaRows(SCAN), 'ds1');
  expect(chunks.some((c) => c.path.includes('LocalDateTable'))).toBe(false);
});

test('countWithExpression reporta o número que o rag status mostra', () => {
  expect(countWithExpression(scanToSchemaRows(SCAN))).toEqual({ total: 2, comFormula: 2 });
});

test('scan sem tabelas devolve tudo vazio, sem quebrar', () => {
  expect(scanToSchemaRows({ id: 'x', name: 'y' })).toEqual({ tables: [], measures: [], columns: [] });
});
