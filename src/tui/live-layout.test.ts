import { test, expect } from 'bun:test';
import type { ChatMessage, ChatPart } from './state.js';
import { LIVE_TOOLS_SHOWN, liveMessageLines, roomForAvatar } from './live-layout.js';

const msg = (parts: ChatPart[]): ChatMessage => ({ id: 'm', role: 'assistant', parts });
const text = (t: string, id = 't'): ChatPart => ({ id, kind: 'text', text: t });
const tool = (id: string): ChatPart => ({ id, kind: 'tool', text: 'bash' });

test('mensagem vazia quer só a linha do autor', () => {
  expect(liveMessageLines(msg([]))).toBe(1);
});

test('cada linha de texto conta, e as partes somam', () => {
  expect(liveMessageLines(msg([text('uma linha')]))).toBe(2);
  expect(liveMessageLines(msg([text('a\nb\nc')]))).toBe(4);
  expect(liveMessageLines(msg([text('a', 'p1'), text('b\nc', 'p2')]))).toBe(4);
});

test('ferramenta além do que a área viva mostra não infla a conta', () => {
  const muitas = Array.from({ length: LIVE_TOOLS_SHOWN + 5 }, (_, i) => tool(`k${i}`));
  const teto = Array.from({ length: LIVE_TOOLS_SHOWN }, (_, i) => tool(`k${i}`));
  expect(liveMessageLines(msg(muitas))).toBe(liveMessageLines(msg(teto)));
});

test('o personagem cabe enquanto o conteúdo não precisa das linhas dele', () => {
  expect(roomForAvatar(6, 13, 7)).toBe(true); // início do turno: sobra espaço
  expect(roomForAvatar(7, 13, 7)).toBe(false); // passou: o personagem sai
  expect(roomForAvatar(1, 13, 7)).toBe(true);
});

test('terminal apertado: o conteúdo ganha, o personagem nunca entra', () => {
  // cap 4 e ícone de 7: não há arranjo em que ele caiba sem roubar linha.
  expect(roomForAvatar(1, 4, 7)).toBe(false);
});

test('sem personagem (iconRows 0) o teto inteiro é do conteúdo', () => {
  expect(roomForAvatar(13, 13, 0)).toBe(true);
});

test('invariante: com o personagem em cena o conteúdo nunca é cortado por causa dele', () => {
  const ICON = 7;
  for (let cap = 3; cap <= 40; cap++) {
    for (let wanted = 1; wanted <= 60; wanted++) {
      const up = roomForAvatar(wanted, cap, ICON);
      const liveMax = up ? Math.max(3, cap - ICON) : cap;
      if (up) expect(wanted).toBeLessThanOrEqual(liveMax);
      // e sem o personagem o teto é sempre o cheio
      if (!up) expect(liveMax).toBe(cap);
    }
  }
});
