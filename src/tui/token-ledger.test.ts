import { test, expect } from 'bun:test';
import {
  buildLedger,
  summaryCursor,
  ledgerTotal,
  hasWorkInFlight,
  estimateTokens,
  describeLedger,
} from './token-ledger.js';
import type { ChatMessage } from './state.js';

const step = (tokensIn: number, tokensOut: number) => ({
  id: `s-${tokensIn}-${tokensOut}`,
  kind: 'step' as const,
  text: '',
  step: { tokensIn, tokensOut, cost: 0 },
});

const assistant = (parts: ReturnType<typeof step>[], extra = {}): ChatMessage => ({
  id: Math.random().toString(36).slice(2),
  role: 'assistant',
  parts,
  ...extra,
});

const user = (): ChatMessage => ({ id: Math.random().toString(36).slice(2), role: 'user', parts: [] });

test('ACEITE: o saldo começa do último resumo, não do início da sessão', () => {
  // Sem o cursor, somar o histórico faria o orçamento parecer estourado logo DEPOIS
  // de uma compactação bem-sucedida — e a TUI compactaria em loop.
  const msgs = [
    assistant([step(90_000, 500)]),
    assistant([], { summary: true }), // compactou aqui
    assistant([step(12_000, 300)]),
  ];
  const l = buildLedger(msgs);

  expect(l.summaryAt).toBe(1);
  expect(l.processedIn).toBe(12_000); // e não 90.000
  expect(l.messagesSinceSummary).toBe(1);
});

test('tokensIn é estado do contexto, não incremento — usa o maior, não a soma', () => {
  const l = buildLedger([assistant([step(10_000, 100), step(14_000, 200)])]);
  expect(l.processedIn).toBe(14_000); // não 24.000
  expect(l.processedOut).toBe(300); // saída, essa sim, soma
});

test('ACEITE: o que está em voo entra como pendente', () => {
  // É a parte que faltava: enquanto o turno não volta, `tokensIn` é do turno anterior.
  const l = buildLedger([assistant([step(5_000, 100)])], 8_000);
  expect(l.pending).toBe(2_000); // 8.000 chars ÷ 4
  expect(ledgerTotal(l)).toBe(5_000 + 100 + 2_000);
});

test('ACEITE: enquanto há trabalho em voo, a sessão tem o que proteger', () => {
  // É a trava que impede a request de morrer no meio.
  expect(hasWorkInFlight(buildLedger([], 500))).toBe(true);
  expect(hasWorkInFlight(buildLedger([]))).toBe(false);
});

test('mode compaction também marca o corte (o opencode usa os dois sinais)', () => {
  const msgs = [assistant([step(80_000, 10)]), assistant([], { mode: 'compaction' }), assistant([step(1_000, 5)])];
  expect(summaryCursor(msgs)).toBe(1);
  expect(buildLedger(msgs).processedIn).toBe(1_000);
});

test('sessão sem resumo nenhum: cursor -1 e conta tudo', () => {
  const l = buildLedger([assistant([step(700, 30)])]);
  expect(l.summaryAt).toBe(-1);
  expect(l.processedIn).toBe(700);
});

test('mensagem do usuário não polui a contagem de entrada', () => {
  const l = buildLedger([user(), assistant([step(400, 20)]), user()]);
  expect(l.processedIn).toBe(400);
});

test('sessão vazia é zero em tudo, não NaN', () => {
  const l = buildLedger([]);
  expect(ledgerTotal(l)).toBe(0);
  expect(l.pending).toBe(0);
});

test('estimateTokens arredonda pra cima (melhor superestimar que estourar)', () => {
  expect(estimateTokens('abc')).toBe(1);
  expect(estimateTokens('a'.repeat(4001))).toBe(1001);
});

test('a descrição mostra o que está em voo e o corte do resumo', () => {
  const msgs = [assistant([], { summary: true }), assistant([step(100, 10)])];
  const linha = describeLedger(buildLedger(msgs, 400));
  expect(linha).toContain('em voo');
  expect(linha).toContain('desde o resumo');
});
