/**
 * Extração do que o turno produziu. O caso que importa é o da compactação: o
 * motor emenda um resumo interno depois da resposta, e gravá-lo como saída do
 * turno poria texto ofuscado na trilha em vez da resposta ao usuário.
 */
import { test, expect } from 'bun:test';
import { summarizeTurn } from './turn-summary.js';
import type { ChatMessage } from './state.js';

const msg = (over: Partial<ChatMessage>): ChatMessage => ({
  id: 'm1',
  role: 'assistant',
  parts: [],
  ...over,
});

test('junta o texto e as tools da última resposta', () => {
  const r = summarizeTurn([
    msg({ id: 'u', role: 'user', parts: [{ id: 'p0', kind: 'text', text: 'pergunta' }] }),
    msg({
      id: 'a',
      parts: [
        { id: 'p1', kind: 'text', text: 'achei ' },
        { id: 'p2', kind: 'text', text: '12 arquivos' },
        {
          id: 'p3',
          kind: 'tool',
          text: 'grep',
          tool: { name: 'grep', status: 'completed', output: '' },
        },
        { id: 'p4', kind: 'step', text: '', step: { tokensIn: 90, tokensOut: 8, cost: 0 } },
      ],
    }),
  ]);
  expect(r.text).toBe('achei 12 arquivos');
  expect(r.toolCalls).toEqual([{ tool: 'grep', status: 'completed' }]);
  expect(r).toMatchObject({ tokensIn: 90, tokensOut: 8 });
});

test('pula a mensagem de compactação e pega a resposta real', () => {
  const r = summarizeTurn([
    msg({ id: 'a', parts: [{ id: 'p1', kind: 'text', text: 'a resposta' }] }),
    msg({
      id: 'c',
      mode: 'compaction',
      parts: [{ id: 'p2', kind: 'text', text: 'resumo interno' }],
    }),
  ]);
  // Sem o filtro, a trilha guardaria o resumo ofuscado do motor.
  expect(r.text).toBe('a resposta');
});

test('pula mensagem marcada como summary', () => {
  const r = summarizeTurn([
    msg({ id: 'a', parts: [{ id: 'p1', kind: 'text', text: 'real' }] }),
    msg({ id: 's', summary: true, parts: [{ id: 'p2', kind: 'text', text: 'resumo' }] }),
  ]);
  expect(r.text).toBe('real');
});

test('ignora mensagem do usuário', () => {
  const r = summarizeTurn([
    msg({ id: 'u', role: 'user', parts: [{ id: 'p', kind: 'text', text: 'oi' }] }),
  ]);
  expect(r.text).toBe('');
});

test('sem mensagens devolve resumo vazio, não lança', () => {
  expect(summarizeTurn([])).toEqual({ text: '', toolCalls: [], tokensIn: 0, tokensOut: 0 });
});
