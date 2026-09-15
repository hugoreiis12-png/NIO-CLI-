import { test, expect, afterEach } from 'bun:test';
import { estimateInputTokens, parseFileBlocks, qwenComplete } from './qwen-client.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Stub de `fetch` que devolve um JSON de /chat/completions e captura o body enviado. */
function stubChat(payload: unknown): { readonly body: () => Record<string, unknown> } {
  let sent: Record<string, unknown> = {};
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    sent = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => payload, text: async () => '' };
  }) as unknown as typeof fetch;
  return { body: () => sent };
}

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

test('qwenComplete manda enable_thinking:false por padrão (reasoning off)', async () => {
  const stub = stubChat({ choices: [{ message: { content: 'oi' }, finish_reason: 'stop' }] });
  const out = await qwenComplete('ping');
  expect(out).toBe('oi');
  expect(stub.body().chat_template_kwargs).toEqual({ enable_thinking: false });
});

test('qwenComplete lança em content vazio', async () => {
  stubChat({ choices: [{ message: { content: '' }, finish_reason: 'stop' }] });
  await expect(qwenComplete('ping')).rejects.toThrow(/resposta vazia/);
});

test('qwenComplete aponta o teto de saída quando corta no length', async () => {
  stubChat({ choices: [{ message: { content: '' }, finish_reason: 'length' }] });
  await expect(qwenComplete('ping')).rejects.toThrow(/NIO_AI_OUTPUT/);
});