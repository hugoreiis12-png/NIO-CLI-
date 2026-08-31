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
  expect(f).toContain('paleta de comandos'); // sidebar: atalhos
  unmount();
});

test('App: splash mostra o wordmark do operador', () => {
  const { lastFrame, unmount } = render(
    <App handle={fakeHandle()} program={buildProgram()} cwd="/tmp/p" session={null} splashMs={5000} />,
  );
  expect(lastFrame() ?? '').toContain('operador NIO');
  unmount();
});
