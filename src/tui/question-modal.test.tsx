import { test, expect } from 'bun:test';
import React from 'react';
import { render } from 'ink-testing-library';
import { stripAnsi } from './test-utils.js';
import { QuestionModal } from './question-modal.js';
import type { QuestionItem, QuestionReq } from './state.js';

const req = (q: Partial<QuestionItem>): QuestionReq => ({
  id: 'req_1',
  sessionId: 'ses_1',
  questions: [
    {
      question: 'Qual dataset?',
      options: [{ label: 'COMERCIAL' }, { label: 'FINANCEIRO' }, { label: 'LOGISTICA' }],
      ...q,
    },
  ],
});

const ENTER = '\r';
const UP = '\u001B[A';
const DOWN = '\u001B[B';
const ESC = '\u001B';
const BACKSPACE = '\u007F';

/** Monta o modal e devolve um `press` que espera a pintura entre as teclas. */
function montar(r: QuestionReq) {
  let answered: string[][] | null = null;
  let rejected = false;
  const ui = render(
    <QuestionModal req={r} queued={1} onAnswer={(a) => { answered = a; }} onReject={() => { rejected = true; }} />,
  );
  const press = async (...keys: string[]): Promise<void> => {
    // O Ink só assina o stdin depois da 1ª pintura — sem esta espera a PRIMEIRA
    // tecla é engolida (medido: `\u001B[B` inicial não chega ao `useInput`).
    await new Promise((res) => setTimeout(res, 30));
    for (const k of keys) {
      ui.stdin.write(k);
      await new Promise((res) => setTimeout(res, 20));
    }
  };
  return {
    press,
    frame: () => stripAnsi(ui.lastFrame()),
    answer: () => answered as string[][] | null,
    wasRejected: () => rejected,
    unmount: ui.unmount,
  };
}

test('escolha única: ↓ move e ↵ devolve a opção selecionada', async () => {
  const m = montar(req({}));
  await m.press(DOWN, ENTER);
  expect(m.answer()).toEqual([['FINANCEIRO']]);
  m.unmount();
});

test('ACEITE: multi marca com Espaço e devolve TODAS as marcadas', async () => {
  // Antes o modal devolvia sempre uma só (`[opts[sel].label]`), ignorando `multi`.
  const m = montar(req({ multi: true }));
  await m.press(' ', DOWN, DOWN, ' ', ENTER);
  expect(m.answer()).toEqual([['COMERCIAL', 'LOGISTICA']]);
  m.unmount();
});

test('multi sem nada marcado cai na opção sob o cursor (não devolve vazio)', async () => {
  const m = montar(req({ multi: true }));
  await m.press(ENTER);
  expect(m.answer()).toEqual([['COMERCIAL']]);
  m.unmount();
});

test('ACEITE: custom deixa escrever resposta fora das opções', async () => {
  // É a saída pro caso em que nenhuma opção serve — sem isso vira beco sem saída.
  const m = montar(req({ custom: true }));
  await m.press('O', 'U', 'T', 'R', 'O', ENTER);
  expect(m.answer()).toEqual([['OUTRO']]);
  m.unmount();
});

test('sem custom, digitar NÃO vira resposta (toque perdido não sequestra a escolha)', async () => {
  const m = montar(req({}));
  await m.press('x', 'y', 'z', ENTER);
  expect(m.answer()).toEqual([['COMERCIAL']]);
  m.unmount();
});

test('texto livre vence a opção destacada', async () => {
  const m = montar(req({ custom: true }));
  await m.press(DOWN, 'L', 'A', 'B', ENTER);
  expect(m.answer()).toEqual([['LAB']]);
  m.unmount();
});

test('backspace apaga o rascunho e volta pro modo de escolha', async () => {
  const m = montar(req({ custom: true }));
  await m.press('A', 'B', BACKSPACE, BACKSPACE, ENTER);
  expect(m.answer()).toEqual([['COMERCIAL']]); // rascunho vazio → volta pra opção
  m.unmount();
});

test('Esc rejeita — o usuário não fica preso na pergunta', async () => {
  const m = montar(req({}));
  await m.press(ESC);
  expect(m.wasRejected()).toBe(true);
  expect(m.answer()).toBeNull();
  m.unmount();
});

test('perguntas em sequência: responde uma por vez e envia todas juntas', async () => {
  const dois: QuestionReq = {
    id: 'req_2',
    sessionId: 'ses_1',
    questions: [
      { question: 'Dataset?', options: [{ label: 'A' }, { label: 'B' }] },
      { question: 'Período?', options: [{ label: '2025' }, { label: '2026' }] },
    ],
  };
  const m = montar(dois);
  await m.press(ENTER, DOWN, ENTER);
  expect(m.answer()).toEqual([['A'], ['2026']]);
  m.unmount();
});

test('o modal anuncia o modo: marcar no multi, escrever no custom', async () => {
  const multi = montar(req({ multi: true }));
  await m_settle();
  expect(multi.frame()).toContain('Espaço marcar');
  expect(multi.frame()).toContain('[ ] COMERCIAL'); // checkbox, não "1."
  multi.unmount();

  const livre = montar(req({ custom: true }));
  await m_settle();
  expect(livre.frame()).toContain('outra resposta');
  livre.unmount();
});

test('↑ no topo não sai da lista', async () => {
  const m = montar(req({}));
  await m.press(UP, ENTER);
  expect(m.answer()).toEqual([['COMERCIAL']]);
  m.unmount();
});

/** Espera a 1ª pintura do Ink assentar. */
function m_settle(): Promise<void> {
  return new Promise((r) => setTimeout(r, 25));
}
