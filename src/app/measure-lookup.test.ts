import { test, expect } from 'bun:test';
import { parseMeasureChunk, parseMeasureChunks } from './measure-lookup.js';

// Forma real gravada pelo schema-chunker, com fórmula multilinha (caso do modelo real).
const CHUNK = `Medida: 2024_FAT_BRUTO
Tabela: VISAO_COMERCIAL
Expressão DAX: CALCULATE(
[TOTAL_LINHA_DADOS_NF_SAIDA],
    FILTER(CALENDARIO, CALENDARIO[Date] >= DATE(2024, 1, 1)))`;

test('ACEITE: fórmula multilinha vem inteira, não só a primeira linha', () => {
  const m = parseMeasureChunk(CHUNK)!;
  expect(m.nome).toBe('2024_FAT_BRUTO');
  expect(m.tabela).toBe('VISAO_COMERCIAL');
  expect(m.formula).toContain('TOTAL_LINHA_DADOS_NF_SAIDA');
  expect(m.formula).toContain('DATE(2024, 1, 1)'); // a última linha tambem
});

test('medida sem fórmula (locatário sem os toggles) → formula undefined, nome intacto', () => {
  const m = parseMeasureChunk('Medida: X\nTabela: T')!;
  expect(m.nome).toBe('X');
  expect(m.formula).toBeUndefined();
});

test('chunk que não é de medida devolve null', () => {
  expect(parseMeasureChunk('Tabela: VISAO_COMERCIAL\nColunas: a, b')).toBeNull();
});

test('descrição é lida sem engolir a fórmula que vem depois', () => {
  const m = parseMeasureChunk('Medida: M\nDescrição: soma tudo\nExpressão DAX: SUM(T[x])')!;
  expect(m.descricao).toBe('soma tudo');
  expect(m.formula).toBe('SUM(T[x])');
});

test('lista ignora chunks inválidos sem quebrar', () => {
  expect(parseMeasureChunks([CHUNK, 'lixo', 'Medida: Y'])).toHaveLength(2);
});
