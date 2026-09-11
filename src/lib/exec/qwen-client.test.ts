import { test, expect } from 'bun:test';
import { estimateInputTokens, parseFileBlocks, qwenComplete } from './qwen-client.js';

test('parseFileBlocks extrai caminho e conteúdo', () => {
  const text = '<<<FILE src/a.ts>>>\nconst a = 1;\n<<<END_FILE>>>';
  expect(parseFileBlocks(text)).toEqual([{ path: 'src/a.ts', content: 'const a = 1;\n' }]);
});

test('parseFileBlocks ignora texto de fora dos blocos', () => {
  const text = 'texto solto\n<<<FILE b.txt>>>\nconteudo\n<<<END_FILE>>>\nfim';
  expect(parseFileBlocks(text)).toEqual([{ path: 'b.txt', content: 'conteudo\n' }]);
});

test('parseFileBlocks devolve vazio sem blocos', () => {
  expect(parseFileBlocks('só texto, sem blocos')).toEqual([]);
});

test('parseFileBlocks lida com múltiplos arquivos em ordem', () => {
  const text = [
    '<<<FILE a.ts>>>',
    'A',
    '<<<END_FILE>>>',
    '<<<FILE b.ts>>>',
    'B',
    '<<<END_FILE>>>',
  ].join('\n');
  const blocks = parseFileBlocks(text);
  expect(blocks).toHaveLength(2);
  expect(blocks[0].path).toBe('a.ts');
  expect(blocks[1].path).toBe('b.ts');
});

test('parseFileBlocks ignora bloco sem caminho', () => {
  expect(parseFileBlocks('<<<FILE>>>\nx\n<<<END_FILE>>>')).toEqual([]);
});

test('parseFileBlocks aceita CRLF vindo do Windows', () => {
  const text = '<<<FILE x.ts>>>\r\nX\r\n<<<END_FILE>>>';
  expect(parseFileBlocks(text)).toEqual([{ path: 'x.ts', content: 'X\r\n' }]);
});

test('estimateInputTokens aproxima ~4 chars por token', () => {
  expect(estimateInputTokens(undefined, 'a'.repeat(4000))).toBe(1000);
  expect(estimateInputTokens('bb', 'aa')).toBe(1); // 4 chars → 1
});

test('qwenComplete recusa prompt acima do teto antes do fetch', async () => {
  await expect(qwenComplete('x'.repeat(200_000))).rejects.toThrow(/NIO_AI_MAX_INPUT/);
});