import { test, expect } from 'bun:test';
import { normalizeQuestion, questionHash, summarizeOutput, isCacheHit } from './rag-templates.js';

test('normalizeQuestion: caixa, acento, espaços e pontuação final convergem', () => {
  const a = normalizeQuestion('Qual o Total de Vendas?');
  expect(a).toBe('qual o total de vendas');
  expect(normalizeQuestion('  qual   o TOTAL de vendas!!  ')).toBe(a);
  expect(normalizeQuestion('Qual o Total de Vêndas')).toBe('qual o total de vendas'); // sem diacrítico
});

test('normalizeQuestion: não altera o miolo da frase', () => {
  expect(normalizeQuestion('vendas por região em 2026')).toBe('vendas por regiao em 2026');
});

test('questionHash: mesma pergunta + mesmo escopo = mesma chave', () => {
  const q = normalizeQuestion('total de vendas');
  expect(questionHash(q, 'ws', 'ds')).toBe(questionHash(q, 'ws', 'ds'));
});

test('questionHash: MESMO texto em dataset diferente = chave diferente (DAX não é portável)', () => {
  const q = normalizeQuestion('total de vendas');
  expect(questionHash(q, 'ws', 'ds-A')).not.toBe(questionHash(q, 'ws', 'ds-B'));
  expect(questionHash(q, 'ws-A', 'ds')).not.toBe(questionHash(q, 'ws-B', 'ds'));
});

test('summarizeOutput: conta linhas, extrai colunas e limita a amostra', () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({ 'T[Mes]': i, 'T[Total]': i * 10 }));
  const out = summarizeOutput(rows);
  expect(out.rowCount).toBe(50);
  expect(out.columns).toEqual(['T[Mes]', 'T[Total]']);
  expect(out.sample).toHaveLength(3); // amostra curta, não as 50
});

test('summarizeOutput: resultado vazio não quebra', () => {
  expect(summarizeOutput([])).toEqual({ rowCount: 0, columns: [], sample: [] });
});

test('summarizeOutput: célula gigante é truncada (template tem que ser leve)', () => {
  const out = summarizeOutput([{ 'T[Nota]': 'x'.repeat(5000) }]);
  const cell = out.sample[0]!['T[Nota]'] as string;
  expect(cell.length).toBeLessThan(300);
  expect(cell.endsWith('…')).toBe(true);
});

test('summarizeOutput: preserva tipos não-string na amostra', () => {
  const out = summarizeOutput([{ n: 42, b: true, nulo: null }]);
  expect(out.sample[0]).toEqual({ n: 42, b: true, nulo: null });
});

test('isCacheHit: respeita o limiar e rejeita score inválido', () => {
  expect(isCacheHit(0.95, 0.9)).toBe(true);
  expect(isCacheHit(0.9, 0.9)).toBe(true); // limiar é inclusivo
  expect(isCacheHit(0.89, 0.9)).toBe(false);
  expect(isCacheHit(Number.NaN, 0.9)).toBe(false);
});
