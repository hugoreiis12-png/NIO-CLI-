import { test, expect } from 'bun:test';
import { applyEvent, pushUserMessage, emptyChat } from './state.js';
import type { Event } from '@opencode-ai/sdk';

const ev = (type: string, properties: unknown): Event => ({ type, properties } as unknown as Event);

test('fluxo típico: eco do usuário é reconciliado, reasoning separado do texto, idle limpa busy', () => {
  let s = pushUserMessage(emptyChat, 'Diga PONG');
  expect(s.messages).toHaveLength(1);
  expect(s.busy).toBe(true);

  // mensagem real do usuário → substitui o eco `pending-user`
  s = applyEvent(s, ev('message.updated', { info: { id: 'msg_u', role: 'user' } }));
  s = applyEvent(s, ev('message.part.updated', { part: { type: 'text', text: 'Diga PONG', messageID: 'msg_u', id: 'prt_u' } }));
  expect(s.messages.filter((m) => m.role === 'user')).toHaveLength(1);
  expect(s.messages[0].id).toBe('msg_u');

  // assistant: step-start (ignorado) + reasoning + text streamado
  s = applyEvent(s, ev('message.updated', { info: { id: 'msg_a', role: 'assistant' } }));
  s = applyEvent(s, ev('message.part.updated', { part: { type: 'step-start', messageID: 'msg_a', id: 'prt_s' } }));
  s = applyEvent(s, ev('message.part.updated', { part: { type: 'reasoning', text: 'pensa...', messageID: 'msg_a', id: 'prt_r' } }));
  s = applyEvent(s, ev('message.part.updated', { part: { type: 'text', text: '', messageID: 'msg_a', id: 'prt_t' } }));
  s = applyEvent(s, ev('message.part.updated', { part: { type: 'text', text: 'PONG', messageID: 'msg_a', id: 'prt_t' } }));

  const a = s.messages.find((m) => m.role === 'assistant')!;
  expect(a.parts.find((p) => p.id === 'prt_s')).toBeUndefined(); // step-start não vira parte
  expect(a.parts.find((p) => p.kind === 'reasoning')?.text).toBe('pensa...');
  expect(a.parts.find((p) => p.kind === 'text')?.text).toBe('PONG'); // último snapshot vence

  s = applyEvent(s, ev('session.idle', { sessionID: 'ses_x' }));
  expect(s.busy).toBe(false);
});

test('tool part: título + status + output (e error vira output)', () => {
  let s = emptyChat;
  s = applyEvent(s, ev('message.part.updated', {
    part: { type: 'tool', tool: 'read', messageID: 'msg_a', id: 'prt_tool',
      state: { status: 'completed', title: 'Lendo x.ts', output: 'conteúdo' } },
  }));
  const tp = s.messages[0].parts[0];
  expect(tp.kind).toBe('tool');
  expect(tp.text).toBe('Lendo x.ts');
  expect(tp.tool).toEqual({ status: 'completed', output: 'conteúdo' });

  s = applyEvent(s, ev('message.part.updated', {
    part: { type: 'tool', tool: 'bash', messageID: 'msg_a', id: 'prt_err',
      state: { status: 'error', error: 'falhou feio' } },
  }));
  expect(s.messages[0].parts[1].tool).toEqual({ status: 'error', output: 'falhou feio' });
});

test('permission.updated → state.permission (properties É a Permission); replied limpa', () => {
  let s = applyEvent(emptyChat, ev('permission.updated', {
    id: 'perm_1', sessionID: 'ses_1', title: 'rodar bash `rm`', type: 'bash',
  }));
  expect(s.permission).toEqual({ id: 'perm_1', sessionId: 'ses_1', title: 'rodar bash `rm`' });
  s = applyEvent(s, ev('permission.replied', { sessionID: 'ses_1', permissionID: 'perm_1', response: 'reject' }));
  expect(s.permission).toBeNull();
});

test('session.status idle também limpa busy', () => {
  const s = applyEvent({ ...emptyChat, busy: true }, ev('session.status', { status: { type: 'idle' } }));
  expect(s.busy).toBe(false);
});
