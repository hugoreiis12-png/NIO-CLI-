import { test, expect } from 'bun:test';
import React from 'react';
import { render } from 'ink-testing-library';
import { App } from './app.js';
import { buildProgram } from '../cli/program.js';
import type { OpencodeHandle } from './opencode.js';

/** Handle fake — session.create/list resolvem vazio, event stream não emite nada. */
function fakeHandle(): OpencodeHandle {
  const client = {
    session: {
      create: async () => ({ data: { id: 'ses_fake' } }),
      list: async () => ({ data: [] }),
      abort: async () => ({}),
      prompt: async () => ({}),
    },
    event: {
      subscribe: async () => ({ stream: (async function* () {})() }),
    },
    postSessionIdPermissionsPermissionId: async () => ({}),
  };
  return { client: client as unknown as OpencodeHandle['client'], url: 'http://127.0.0.1:4096', close: () => {} };
}

test('App: pula o splash → mostra header, sidebar e input', async () => {
  const { lastFrame, unmount } = render(
    <App
      handle={fakeHandle()}
      program={buildProgram()}
      cwd="/tmp/proj"
      session={{ name: 'demo', profile: 'dba', id: 'aaaa1111bb' }}
      splashMs={0}
    />,
  );
  await new Promise((r) => setTimeout(r, 20));
  const f = lastFrame() ?? '';
  expect(f).toContain('N I O');
  expect(f).toContain('demo'); // sidebar: sessão
  expect(f).toContain('paleta'); // sidebar: atalhos
  expect(f).toContain('›'); // input
  unmount();
});

test('App: splash mostra o wordmark do operador', () => {
  const { lastFrame, unmount } = render(
    <App handle={fakeHandle()} program={buildProgram()} cwd="/tmp/p" session={null} splashMs={5000} />,
  );
  expect(lastFrame() ?? '').toContain('operador NIO');
  unmount();
});

test('App: resposta gigante em andamento NÃO estoura o frame (Static + LiveMessage capado)', async () => {
  const bigStream = (async function* () {
    yield { type: 'message.updated', properties: { info: { id: 'msg_a', role: 'assistant' } } };
    let acc = '';
    for (let i = 0; i < 80; i++) {
      acc += `raciocínio linha ${i}\n`;
      yield { type: 'message.part.updated', properties: { part: { type: 'text', text: acc, messageID: 'msg_a', id: 'prt_t' } } };
    }
  })();
  const h = fakeHandle();
  (h.client as unknown as { event: { subscribe: () => Promise<{ stream: AsyncGenerator }> } }).event.subscribe = async () => ({ stream: bigStream });

  const { lastFrame, stdin, unmount } = render(
    <App handle={h} program={buildProgram()} cwd="/tmp/proj" session={null} splashMs={0} />,
  );
  // dispara o busy
  await new Promise((r) => setTimeout(r, 10));
  stdin.write('oi\r');
  await new Promise((r) => setTimeout(r, 80));

  const lines = (lastFrame() ?? '').split('\n');
  expect(lines.length).toBeLessThan(40); // não vira uma parede de 80+ linhas
  unmount();
});
