import { test, expect } from 'bun:test';
import React from 'react';
import { render } from 'ink-testing-library';
import { frameOf } from './test-utils.js';
import { Footer, MessageView, LiveMessage, InputBox } from './components.js';
import { buildPalette } from './palette-source.js';
import { buildProgram } from '../cli/program.js';
import type { ChatMessage } from './state.js';

test('Footer: modelo · pasta · sessão · tokens + linha de atalhos (Sprint 4)', () => {
  const { lastFrame } = render(
    <Footer
      model="big-pickle"
      cwd="/Users/hugo/Desktop/app-web"
      session={{ name: 'app-web', profile: 'fullstack' }}
      mode="plan"
      sessionTokens={12500}
    />,
  );
  const f = lastFrame() ?? '';
  expect(f).toContain('big-pickle');
  expect(f).toContain('app-web'); // pasta = basename do cwd (e nome da sessão)
  expect(f).toContain('fullstack');
  expect(f).toContain('12.5k tok');
  expect(f).toContain('[plan]'); // pill de modo (Sprint 5)
  expect(f).toContain('paleta');
  expect(f).toContain('sair');
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

test('InputBox: `/…` mostra UMA lista inline; sem `/` não mostra lista', async () => {
  const palette = buildPalette(buildProgram());
  const listCount = (f: string) => f.split('Esc sai').length - 1;
  const box = (value: string, active = true) => (
    <InputBox
      value={value}
      onChange={() => {}}
      disabled={false}
      active={active}
      palette={palette}
      onSubmit={() => {}}
      onDispatch={() => {}}
    />
  );

  expect(listCount(await frameOf(box('oi tudo bem')))).toBe(0);

  const oneSlash = await frameOf(box('/debug'));
  expect(listCount(oneSlash)).toBe(1);
  expect(oneSlash).toContain('[cmd] debug');

  // `//…` → ainda UMA lista (não duplica), filtra por tudo depois do 1º `/`
  expect(listCount(await frameOf(box('//x')))).toBe(1);

  // active=false (overlay por cima) → não mostra a droplist
  expect(listCount(await frameOf(box('/debug', false)))).toBe(0);
});

test('InputBox: Enter num comando dispara ação "run" (Sprint 6)', async () => {
  const palette = buildPalette(buildProgram());
  let got: { name: string; action: string } | null = null;
  const { stdin } = render(
    <InputBox
      value="/whoami"
      onChange={() => {}}
      disabled={false}
      palette={palette}
      onSubmit={() => {}}
      onDispatch={(item, action) => {
        got = { name: item.name, action };
      }}
    />,
  );
  await new Promise((r) => setTimeout(r, 30));
  stdin.write('\r');
  await new Promise((r) => setTimeout(r, 30));
  expect(got).toEqual({ name: 'whoami', action: 'run' });
});

test('LiveMessage: limita a `maxLines` (não estoura a tela)', () => {
  const long = Array.from({ length: 50 }, (_, i) => `linha ${i}`).join('\n');
  const msg: ChatMessage = { id: 'a', role: 'assistant', parts: [{ id: 'p', kind: 'text', text: long }] };
  const f = render(<LiveMessage message={msg} maxLines={10} />).lastFrame() ?? '';
  const bodyLines = f.split('\n').filter((l) => /linha \d/.test(l));
  expect(bodyLines.length).toBeLessThanOrEqual(10);
  expect(f).toContain('linha 49'); // mostra o fim
  expect(f).toContain('rolagem acima'); // avisa que clipou
});

test('LiveMessage: reflete o motor — checklist, tool(args+saída), retry, tokens (Sprint 2)', async () => {
  const msg: ChatMessage = {
    id: 'a',
    role: 'assistant',
    parts: [
      {
        id: 't1',
        kind: 'tool',
        text: 'Lendo messaging.ts',
        tool: { name: 'read', status: 'completed', input: { filePath: 'src/core/messaging.ts' }, output: 'export interface OtpSender {\n  ...' },
      },
      { id: 's1', kind: 'step', text: '', step: { tokensIn: 1200, tokensOut: 3400, cost: 0.012 } },
      { id: 'x1', kind: 'text', text: 'pronto' },
    ],
  };
  const f = await frameOf(
    <LiveMessage
      message={msg}
      maxLines={20}
      todos={[
        { content: 'Ler o adapter atual', status: 'completed' },
        { content: 'Trocar OtpSender por OtpMessenger', status: 'in_progress' },
        { content: 'Rodar os testes', status: 'pending' },
      ]}
      files={['src/core/messaging.ts', 'src/adapters/messaging/smtp.ts']}
      retry={{ attempt: 2, note: 'rate limit' }}
    />,
  );

  expect(f).toContain('☑ Ler o adapter atual');
  expect(f).toContain('◐ Trocar OtpSender por OtpMessenger');
  expect(f).toContain('☐ Rodar os testes');
  expect(f).toContain('read(src/core/messaging.ts)'); // nome + args da tool
  expect(f).toContain('⎿ export interface OtpSender'); // 1ª linha da saída
  expect(f).toContain('↻ tentativa 2 — rate limit');
  expect(f).toContain('↑1.2k ↓3.4k'); // tokens
  expect(f).toContain('$0.012'); // custo
  expect(f).toContain('2 arquivo(s)'); // arquivos editados
});

test('LiveMessage: raciocínio colapsado (padrão) vs expandido — Sprint 3', () => {
  const long = Array.from({ length: 8 }, (_, i) => `passo de raciocínio ${i}`).join('\n');
  const msg: ChatMessage = {
    id: 'a',
    role: 'assistant',
    parts: [{ id: 'r', kind: 'reasoning', text: long }],
  };

  const collapsed = render(<LiveMessage message={msg} maxLines={16} />).lastFrame() ?? '';
  expect(collapsed).toContain('✻');
  expect(collapsed).toContain('Ctrl-R'); // a dica
  expect(collapsed.split('\n').filter((l) => l.includes('passo de raciocínio')).length).toBe(1); // 1 linha só

  const expanded = render(<LiveMessage message={msg} maxLines={16} expandReasoning />).lastFrame() ?? '';
  expect(expanded).toContain('✻ raciocínio');
  const shown = expanded.split('\n').filter((l) => l.includes('passo de raciocínio'));
  expect(shown.length).toBeGreaterThanOrEqual(6); // várias linhas
  expect(expanded).toContain('passo de raciocínio 7'); // mostra o fim
});

test('MessageView: raciocínio no histórico vira resumo colapsado — Sprint 3', () => {
  const msg: ChatMessage = {
    id: 'a',
    role: 'assistant',
    parts: [
      { id: 'r', kind: 'reasoning', text: 'primeira linha\nsegunda linha\nterceira linha\nquarta linha' },
      { id: 'x', kind: 'text', text: 'resposta' },
    ],
  };
  const f = render(<MessageView message={msg} />).lastFrame() ?? '';
  expect(f).toContain('✻ raciocínio · 4 linhas');
  expect(f).toContain('primeira linha');
  expect(f).toContain('segunda linha');
  expect(f).not.toContain('quarta linha'); // só as 2 primeiras
});

test('MessageView: assistant fechado mostra o rodapé de tokens/custo', () => {
  const msg: ChatMessage = {
    id: 'a',
    role: 'assistant',
    parts: [
      { id: 'x', kind: 'text', text: 'feito' },
      { id: 's', kind: 'step', text: '', step: { tokensIn: 500, tokensOut: 900, cost: 0.004 } },
    ],
  };
  const f = render(<MessageView message={msg} />).lastFrame() ?? '';
  expect(f).toContain('↑500 ↓900');
  expect(f).toContain('$0.004');
  expect(f).not.toContain('step'); // o part `step` não renderiza inline
});
