import { test, expect } from 'bun:test';
import React from 'react';
import { render } from 'ink-testing-library';
import { Sidebar, MessageView, LiveMessage } from './components.js';
import type { ChatMessage } from './state.js';

test('Sidebar: mostra sessão, lista e atalhos', () => {
  const { lastFrame } = render(
    <Sidebar
      session={{ name: 'app-web', profile: 'fullstack', id: 'abcd1234ef' }}
      sessions={[{ id: 's0', title: 'atual' }, { id: 's1', title: 'antiga' }]}
    />,
  );
  const f = lastFrame() ?? '';
  expect(f).toContain('app-web');
  expect(f).toContain('fullstack');
  expect(f).toContain('abcd1234');
  expect(f).toContain('antiga'); // outras sessões (aparece com >1)
  expect(f).toContain('paleta');
});

test('MessageView: renderiza texto do assistant e do usuário', () => {
  const messages: ChatMessage[] = [
    { id: 'u1', role: 'user', parts: [{ id: 'p', kind: 'text', text: 'oi' }] },
    { id: 'a1', role: 'assistant', parts: [{ id: 'p', kind: 'text', text: 'olá **mundo**' }] },
  ];
  const f = messages.map((m) => render(<MessageView message={m} />).lastFrame() ?? '').join('\n');
  expect(f).toContain('você');
  expect(f).toContain('oi');
  expect(f).toContain('nio');
  expect(f).toContain('mundo');
});

test('LiveMessage: limita a `maxLines` (não estoura a tela)', () => {
  const long = Array.from({ length: 50 }, (_, i) => `linha ${i}`).join('\n');
  const msg: ChatMessage = { id: 'a', role: 'assistant', parts: [{ id: 'p', kind: 'text', text: long }] };
  const f = render(<LiveMessage message={msg} maxLines={6} />).lastFrame() ?? '';
  const bodyLines = f.split('\n').filter((l) => l.includes('linha '));
  expect(bodyLines.length).toBeLessThanOrEqual(6);
  expect(f).toContain('linha 49'); // mostra o fim
  expect(f).toContain('rolagem acima'); // avisa que clipou
});
