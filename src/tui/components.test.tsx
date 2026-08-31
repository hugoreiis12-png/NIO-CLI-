import { test, expect } from 'bun:test';
import React from 'react';
import { render } from 'ink-testing-library';
import { Sidebar, MessageList } from './components.js';
import type { ChatMessage } from './state.js';

test('Sidebar: mostra sessão, lista e atalhos', () => {
  const { lastFrame } = render(
    <Sidebar
      session={{ name: 'app-web', profile: 'fullstack', id: 'abcd1234ef' }}
      sessions={[{ id: 's1', title: 'antiga' }]}
    />,
  );
  const f = lastFrame() ?? '';
  expect(f).toContain('app-web');
  expect(f).toContain('fullstack');
  expect(f).toContain('abcd1234'); // id curto
  expect(f).toContain('antiga');
  expect(f).toContain('paleta de comandos');
});

test('MessageList: renderiza texto do assistant e do usuário', () => {
  const messages: ChatMessage[] = [
    { id: 'u1', role: 'user', parts: [{ id: 'p', kind: 'text', text: 'oi' }] },
    { id: 'a1', role: 'assistant', parts: [{ id: 'p', kind: 'text', text: 'olá **mundo**' }] },
  ];
  const f = render(<MessageList messages={messages} />).lastFrame() ?? '';
  expect(f).toContain('você');
  expect(f).toContain('oi');
  expect(f).toContain('nio');
  expect(f).toContain('mundo');
});
