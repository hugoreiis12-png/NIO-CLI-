import { test, expect } from 'bun:test';
import { chunkByTokens, compactInput } from './map-reduce.js';

test('chunkByTokens: respeita o teto e cobre todo o texto', () => {
  const text = Array.from({ length: 20 }, (_, i) => `paragrafo numero ${i} com algum conteudo`).join('\n\n');
  const chunks = chunkByTokens(text, 20); // 20 tokens ~= 80 chars por chunk
  expect(chunks.length).toBeGreaterThan(1);
  for (const c of chunks) expect(c.length).toBeLessThanOrEqual(20 * 4);
  expect(chunks.join('')).toBe(text.replace(/\n\s*\n/g, (m) => m)); // sem perda de conteúdo
});

test('compactInput: abaixo do teto → devolve intacto, sem chamar o motor', async () => {
  let calls = 0;
  const out = await compactInput('texto curto', {
    threshold: 1000,
    complete: async () => {
      calls++;
      return 'x';
    },
  });
  expect(out).toBe('texto curto');
  expect(calls).toBe(0);
});

test('compactInput: acima do teto → mapeia cada chunk e junta os resumos', async () => {
  const big = 'A'.repeat(4000); // ~1000 tokens estimados
  const seen: number[] = [];
  const out = await compactInput(big, {
    threshold: 100, // força compactar
    maxChunkTokens: 100, // ~400 chars/chunk → ~10 chunks
    complete: async (chunk) => {
      seen.push(chunk.length);
      return 'RESUMO';
    },
  });
  expect(seen.length).toBeGreaterThan(1); // mapeou vários chunks
  expect(out).toContain('RESUMO'); // reduziu para os resumos
  expect(out.length).toBeLessThan(big.length); // ficou menor
});

test('compactInput: cap de profundidade — não loopa se o resumo continua grande', async () => {
  const big = 'B'.repeat(8000);
  let calls = 0;
  const out = await compactInput(big, {
    threshold: 50,
    maxChunkTokens: 100,
    maxDepth: 2,
    complete: async () => {
      calls++;
      return 'C'.repeat(1000); // resumo teimosamente grande (força recursão)
    },
  });
  expect(calls).toBeGreaterThan(0);
  expect(typeof out).toBe('string'); // termina (não trava) mesmo sem convergir
});