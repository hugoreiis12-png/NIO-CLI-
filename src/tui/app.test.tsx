import { test, expect } from 'bun:test';
import React from 'react';
import { render } from 'ink-testing-library';
import { waitForFrame, waitForText } from './test-utils.js';
import { App } from './app.js';
import { buildProgram } from '../cli/program.js';
import type { OpencodeHandle } from './opencode.js';

/** Handle fake — session.create resolve, event stream não emite nada por padrão. */
function fakeHandle(over: { onPrompt?: (body: unknown) => void; agents?: unknown[] } = {}): OpencodeHandle {
  const client = {
    session: {
      create: async () => ({ data: { id: 'ses_fake' } }),
      abort: async () => ({}),
      prompt: async (opts: { body?: unknown }) => {
        over.onPrompt?.(opts.body);
        return {};
      },
    },
    app: {
      agents: async () => ({ data: over.agents ?? [{ name: 'build', mode: 'primary' }, { name: 'plan', mode: 'primary' }] }),
    },
    event: {
      subscribe: async () => ({ stream: (async function* () {})() }),
    },
    postSessionIdPermissionsPermissionId: async () => ({}),
  };
  return { client: client as unknown as OpencodeHandle['client'], url: 'http://127.0.0.1:4096', close: () => {} };
}

test('App: pula o splash → mostra o input e o rodapé (sem sidebar — Sprint 4)', async () => {
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
  expect(f).toContain('›'); // input
  expect(f).toContain('big-pickle'); // rodapé: modelo
  expect(f).toContain('demo · dba'); // rodapé: sessão
  expect(f).toContain('paleta'); // rodapé: atalhos
  expect(f).not.toContain('Sessão'); // a sidebar sumiu
  unmount();
});

test('App: Tab cicla o modo do agente e o prompt vai com o `agent` escolhido — Sprint 5', async () => {
  let sentBody: Record<string, unknown> | undefined;
  const h = fakeHandle({
    onPrompt: (b) => { sentBody = b as Record<string, unknown>; },
    agents: [{ name: 'build', mode: 'primary' }, { name: 'plan', mode: 'primary' }, { name: 'reviewer', mode: 'subagent' }],
  });
  const { lastFrame, stdin, unmount } = render(
    <App handle={h} program={buildProgram()} cwd="/tmp/proj" session={null} splashMs={0} />,
  );
  await new Promise((r) => setTimeout(r, 40));
  expect(lastFrame() ?? '').toContain('[build]'); // pill no rodapé, modo default

  stdin.write('\t'); // Tab → próximo modo
  await new Promise((r) => setTimeout(r, 30));
  expect(lastFrame() ?? '').toContain('[plan]');
  expect(lastFrame() ?? '').not.toContain('[reviewer]'); // subagent não entra no ciclo

  stdin.write('\t'); // volta pro build (ciclo)
  await new Promise((r) => setTimeout(r, 30));
  expect(lastFrame() ?? '').toContain('[build]');

  stdin.write('\t'); // plan de novo
  await new Promise((r) => setTimeout(r, 20));
  stdin.write('faça o plano');
  await new Promise((r) => setTimeout(r, 20));
  stdin.write('\r'); // Enter separado (evita virar paste)
  await new Promise((r) => setTimeout(r, 40));
  expect(sentBody?.agent).toBe('plan');
  unmount();
});

test('App: splash mostra o wordmark do operador', () => {
  const { lastFrame, unmount } = render(
    <App handle={fakeHandle()} program={buildProgram()} cwd="/tmp/p" session={null} splashMs={5000} />,
  );
  expect(lastFrame() ?? '').toContain('operador NIO');
  unmount();
});

test('App: rascunho do input sobrevive a um overlay (permissão) — Sprint 6', async () => {
  const stream = (async function* () {
    // segura o stream aberto; a gente empurra o evento de permissão via delay
    yield { type: 'message.updated', properties: { info: { id: 'm1', role: 'assistant' } } };
    await new Promise((r) => setTimeout(r, 40));
    yield {
      type: 'permission.asked',
      properties: {
        id: 'perm1', sessionID: 'ses_fake', permission: 'bash',
        patterns: ['rm -rf build'], metadata: { command: 'rm -rf build' },
      },
    };
    await new Promise((r) => setTimeout(r, 200));
  })();
  const h = fakeHandle();
  (h.client as unknown as { event: { subscribe: () => Promise<{ stream: AsyncGenerator }> } }).event.subscribe =
    async () => ({ stream });

  const { lastFrame, stdin, unmount } = render(
    <App handle={h} program={buildProgram()} cwd="/tmp/proj" session={null} splashMs={0} />,
  );
  await new Promise((r) => setTimeout(r, 15));
  stdin.write('meu rascunho pendente');
  await new Promise((r) => setTimeout(r, 20));
  expect(lastFrame() ?? '').toContain('meu rascunho pendente');

  await new Promise((r) => setTimeout(r, 60)); // deixa o permission.asked chegar
  const f = lastFrame() ?? '';
  expect(f).toContain('permissão'); // o modal apareceu
  expect(f).toContain('rm -rf build'); // mostra o comando
  expect(f).toContain('meu rascunho pendente'); // e o rascunho continua lá

  stdin.write('a'); // responde "permitir uma vez"
  await new Promise((r) => setTimeout(r, 30));
  expect(lastFrame() ?? '').toContain('meu rascunho pendente'); // ainda lá após fechar o modal
  unmount();
});

test('App: Ctrl-R alterna o raciocínio colapsado ⇄ expandido — Sprint 3', async () => {
  const reason = Array.from({ length: 6 }, (_, i) => `linha de raciocínio ${i}`).join('\n');
  const stream = (async function* () {
    yield { type: 'session.status', properties: { status: { type: 'busy' } } };
    yield { type: 'message.updated', properties: { info: { id: 'm1', role: 'assistant' } } };
    yield { type: 'message.part.updated', properties: { part: { type: 'reasoning', text: reason, messageID: 'm1', id: 'r1' } } };
    await new Promise((r) => setTimeout(r, 400));
  })();
  const h = fakeHandle();
  (h.client as unknown as { event: { subscribe: () => Promise<{ stream: AsyncGenerator }> } }).event.subscribe =
    async () => ({ stream });

  const { lastFrame, stdin, unmount } = render(
    <App handle={h} program={buildProgram()} cwd="/tmp/proj" session={null} splashMs={0} />,
  );
  await new Promise((r) => setTimeout(r, 40));

  expect(lastFrame() ?? '').toContain('Ctrl-R'); // colapsado, com a dica
  const collapsedLines = (lastFrame() ?? '').split('\n').filter((l) => l.includes('linha de raciocínio')).length;

  stdin.write('\x12'); // Ctrl-R
  await new Promise((r) => setTimeout(r, 40));
  const expandedLines = (lastFrame() ?? '').split('\n').filter((l) => l.includes('linha de raciocínio')).length;
  expect(expandedLines).toBeGreaterThan(collapsedLines);
  expect(lastFrame() ?? '').toContain('✻ raciocínio');
  unmount();
});

test('App: batch de 3 permissões → modal 1/3 → 2/3 → 3/3, cada resposta faz POST (Sprint 7.1)', async () => {
  const posted: string[] = [];
  const stream = (async function* () {
    yield { type: 'session.status', properties: { status: { type: 'busy' } } };
    yield { type: 'message.updated', properties: { info: { id: 'm1', role: 'assistant' } } };
    for (const id of ['pA', 'pB', 'pC']) {
      yield {
        type: 'permission.asked',
        properties: { id, sessionID: 'ses_fake', permission: 'bash', metadata: { command: `echo ${id}` } },
      };
    }
    await new Promise((r) => setTimeout(r, 400));
  })();
  const h = fakeHandle();
  (h.client as unknown as {
    event: { subscribe: () => Promise<{ stream: AsyncGenerator }> };
    postSessionIdPermissionsPermissionId: (o: { path: { permissionID: string } }) => Promise<unknown>;
  }).event.subscribe = async () => ({ stream });
  (h.client as unknown as { postSessionIdPermissionsPermissionId: (o: { path: { permissionID: string } }) => Promise<unknown> }).postSessionIdPermissionsPermissionId =
    async (o) => { posted.push(o.path.permissionID); return {}; };

  const { lastFrame, stdin, unmount } = render(
    <App handle={h} program={buildProgram()} cwd="/tmp/proj" session={null} splashMs={0} />,
  );
  await new Promise((r) => setTimeout(r, 50));
  expect(lastFrame() ?? '').toContain('+2 na fila');
  expect(lastFrame() ?? '').toContain('echo pA');

  stdin.write('a'); // permitir
  await new Promise((r) => setTimeout(r, 30));
  expect(lastFrame() ?? '').toContain('+1 na fila');
  expect(lastFrame() ?? '').toContain('echo pB');

  stdin.write('d'); // negar
  await new Promise((r) => setTimeout(r, 30));
  expect(lastFrame() ?? '').toContain('echo pC');
  expect(lastFrame() ?? '').not.toContain('na fila'); // último — sem contador

  stdin.write('a');
  await new Promise((r) => setTimeout(r, 30));
  expect(posted).toEqual(['pA', 'pB', 'pC']); // as 3 respondidas, nenhuma órfã
  unmount();
});

test('App: eventos tui.* — toast, prompt.append, command.execute (Sprint 7.2)', async () => {
  const gate = { resume: () => {} };
  const wait = () => new Promise<void>((r) => { gate.resume = r; });
  const stream = (async function* () {
    yield { type: 'tui.toast.show', properties: { message: 'skill carregada', variant: 'success', duration: 9999 } };
    await wait();
    yield { type: 'tui.prompt.append', properties: { text: 'nio deps check' } };
    await wait();
    yield { type: 'tui.command.execute', properties: { command: 'agent.cycle' } };
    await wait();
    yield { type: 'tui.command.execute', properties: { command: 'prompt.clear' } };
    await new Promise((r) => setTimeout(r, 500));
  })();
  const h = fakeHandle({
    agents: [{ name: 'build', mode: 'primary' }, { name: 'plan', mode: 'primary' }],
  });
  (h.client as unknown as { event: { subscribe: () => Promise<{ stream: AsyncGenerator }> } }).event.subscribe =
    async () => ({ stream });

  const { lastFrame, unmount } = render(
    <App handle={h} program={buildProgram()} cwd="/tmp/proj" session={null} splashMs={0} />,
  );
  await waitForText(lastFrame, ['skill carregada', '[build]']);

  gate.resume();
  await waitForText(lastFrame, 'nio deps check'); // prompt.append injetou no input

  gate.resume();
  await waitForText(lastFrame, '[plan]'); // agent.cycle rodou

  gate.resume();
  await waitForFrame(lastFrame, (f) => !f.includes('nio deps check')); // prompt.clear limpou
  unmount();
});

test('App: pergunta com opções → menu navegável; ↓+Enter manda a opção 2 (Sprint 7.6)', async () => {
  let sent: string | undefined;
  const stream = (async function* () {
    yield { type: 'session.status', properties: { status: { type: 'busy' } } };
    yield { type: 'message.updated', properties: { info: { id: 'm1', role: 'assistant' } } };
    yield { type: 'message.part.updated', properties: { part: { type: 'text', text: 'Por onde começo?\n1. Pelo core\n2. Pelos adapters\n3. Pelos testes', messageID: 'm1', id: 't1' } } };
    yield { type: 'session.idle', properties: { sessionID: 'ses_fake' } };
    await new Promise((r) => setTimeout(r, 300));
  })();
  const h = fakeHandle({ onPrompt: (b) => { sent = (b as { parts: { text: string }[] }).parts[0].text; } });
  (h.client as unknown as { event: { subscribe: () => Promise<{ stream: AsyncGenerator }> } }).event.subscribe =
    async () => ({ stream });

  const { lastFrame, stdin, unmount } = render(
    <App handle={h} program={buildProgram()} cwd="/tmp/proj" session={null} splashMs={0} />,
  );
  await new Promise((r) => setTimeout(r, 60));
  const f = lastFrame() ?? '';
  expect(f).toContain('1. Pelo core');
  expect(f).toContain('2. Pelos adapters');
  expect(f).toContain('↑↓ escolher');

  stdin.write('\x1b[B'); // ↓ → seleciona opção 2
  await new Promise((r) => setTimeout(r, 20));
  stdin.write('\r'); // Enter
  await new Promise((r) => setTimeout(r, 40));
  expect(sent).toBe('Pelos adapters');
  unmount();
});

test('App: session.diff → resumo "✎ N arquivo(s)" (Sprint 7.8)', async () => {
  const stream = (async function* () {
    yield { type: 'session.status', properties: { status: { type: 'busy' } } };
    yield { type: 'message.updated', properties: { info: { id: 'm1', role: 'assistant' } } };
    yield {
      type: 'session.diff',
      properties: {
        sessionID: 'ses_fake',
        diff: [
          { file: 'src/gateway/services/security.ts', additions: 18, deletions: 4 },
          { file: 'src/adapters/messaging/smtp.ts', additions: 42, deletions: 0 },
        ],
      },
    };
    await new Promise((r) => setTimeout(r, 200));
  })();
  const h = fakeHandle();
  (h.client as unknown as { event: { subscribe: () => Promise<{ stream: AsyncGenerator }> } }).event.subscribe =
    async () => ({ stream });

  const { lastFrame, unmount } = render(
    <App handle={h} program={buildProgram()} cwd="/tmp/proj" session={null} splashMs={0} />,
  );
  await new Promise((r) => setTimeout(r, 80));
  const f = lastFrame() ?? '';
  expect(f).toContain('✎ 2 arquivo(s)');
  expect(f).toContain('security.ts +18 −4');
  expect(f).toContain('smtp.ts +42');
  unmount();
});

test('App: nio termina com pergunta → cue "↳ o nio perguntou" acima do input (Sprint 7.4)', async () => {
  const stream = (async function* () {
    yield { type: 'session.status', properties: { status: { type: 'busy' } } };
    yield { type: 'message.updated', properties: { info: { id: 'm1', role: 'assistant' } } };
    yield { type: 'message.part.updated', properties: { part: { type: 'text', text: 'Analisei o projeto.\nQuer que eu comece pelo core ou pelos adapters?', messageID: 'm1', id: 't1' } } };
    await new Promise((r) => setTimeout(r, 20));
    yield { type: 'session.idle', properties: { sessionID: 'ses_fake' } };
    await new Promise((r) => setTimeout(r, 200));
  })();
  const h = fakeHandle();
  (h.client as unknown as { event: { subscribe: () => Promise<{ stream: AsyncGenerator }> } }).event.subscribe =
    async () => ({ stream });

  const { lastFrame, unmount } = render(
    <App handle={h} program={buildProgram()} cwd="/tmp/proj" session={null} splashMs={0} />,
  );
  await new Promise((r) => setTimeout(r, 80));
  const f = lastFrame() ?? '';
  expect(f).toContain('o nio perguntou');
  expect(f).toContain('Quer que eu comece pelo core ou pelos adapters?');
  unmount();
});

test('App: session.error → bloco vermelho, input segue vivo (Sprint 7.3)', async () => {
  const stream = (async function* () {
    yield { type: 'session.status', properties: { status: { type: 'busy' } } };
    yield { type: 'message.updated', properties: { info: { id: 'm1', role: 'assistant' } } };
    await new Promise((r) => setTimeout(r, 30));
    yield {
      type: 'session.error',
      properties: { error: { name: 'APIError', data: { message: '429 rate limited', isRetryable: true } } },
    };
    await new Promise((r) => setTimeout(r, 200));
  })();
  const h = fakeHandle();
  (h.client as unknown as { event: { subscribe: () => Promise<{ stream: AsyncGenerator }> } }).event.subscribe =
    async () => ({ stream });

  const { lastFrame, stdin, unmount } = render(
    <App handle={h} program={buildProgram()} cwd="/tmp/proj" session={null} splashMs={0} />,
  );
  await new Promise((r) => setTimeout(r, 80));
  const f = lastFrame() ?? '';
  expect(f).toContain('APIError');
  expect(f).toContain('429 rate limited');
  expect(f).toContain('reenvie o prompt');

  // input não foi bloqueado — dá pra digitar
  stdin.write('tenta de novo');
  await new Promise((r) => setTimeout(r, 20));
  expect(lastFrame() ?? '').toContain('tenta de novo');
  unmount();
});

test('App: resposta gigante em andamento NÃO estoura o frame (Static + LiveMessage capado)', async () => {
  const bigStream = (async function* () {
    yield { type: 'session.status', properties: { status: { type: 'busy' } } };
    yield { type: 'message.updated', properties: { info: { id: 'msg_a', role: 'assistant' } } };
    let acc = '';
    for (let i = 0; i < 80; i++) {
      acc += `raciocínio linha ${i}\n`;
      yield { type: 'message.part.updated', properties: { part: { type: 'text', text: acc, messageID: 'msg_a', id: 'prt_t' } } };
    }
    await new Promise((r) => setTimeout(r, 200));
  })();
  const h = fakeHandle();
  (h.client as unknown as { event: { subscribe: () => Promise<{ stream: AsyncGenerator }> } }).event.subscribe = async () => ({ stream: bigStream });

  const { lastFrame, unmount } = render(
    <App handle={h} program={buildProgram()} cwd="/tmp/proj" session={null} splashMs={0} />,
  );
  await new Promise((r) => setTimeout(r, 80));

  const lines = (lastFrame() ?? '').split('\n');
  expect(lines.length).toBeLessThan(40); // não vira uma parede de 80+ linhas
  unmount();
});
