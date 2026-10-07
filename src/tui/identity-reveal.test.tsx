import { test, expect, afterEach, beforeEach } from 'bun:test';
import React, { useEffect, useRef } from 'react';
import { render } from 'ink-testing-library';
import { envName } from '../brand.js';
import { IDENTITY } from './identity.js';
import { spriteSize, useIdentity, type Identity } from './identity-reveal.js';

const NO_ANIM = envName('NO_ANIM');
let saved: string | undefined;
beforeEach(() => {
  saved = process.env[NO_ANIM];
});
afterEach(() => {
  if (saved === undefined) delete process.env[NO_ANIM];
  else process.env[NO_ANIM] = saved;
});

function Harness({
  text,
  rows,
  columns,
  seen,
}: {
  text: string;
  rows: number;
  columns: number;
  seen: { started?: boolean; identity?: Identity };
}): React.ReactElement {
  const identity = useIdentity(rows, columns);
  seen.identity = identity;
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    seen.started = identity.tryStart(text);
  }, [identity, seen, text]);
  return identity.node;
}

/** O frame com o card final (gravado no scrollback pelo `useStdout().write`). */
const card = (frames: string[]): string => frames.find((f) => f.includes('Eu sou')) ?? '';

const tick = (ms = 60): Promise<void> => new Promise((r) => setTimeout(r, ms));

test('spriteSize: medium com folga, ícone no aperto, só texto no minúsculo', () => {
  expect(spriteSize(40, 100)).toBe('medium');
  expect(spriteSize(25, 100)).toBe('icon');
  expect(spriteSize(40, 50)).toBe('icon');
  expect(spriteSize(15, 100)).toBe('none');
});

test('cena completa (sem animação): pergunta, personagem e apresentação ficam na tela', async () => {
  process.env[NO_ANIM] = '1';
  const seen: { started?: boolean; identity?: Identity } = {};
  const { frames } = render(<Harness text="Quem é você?" rows={40} columns={100} seen={seen} />);
  await tick();
  const f = card(frames);
  expect(seen.started).toBe(true);
  expect(f).toContain('Quem é você?');
  expect(f).toContain(`Eu sou o ${IDENTITY.agent}.`);
  expect(f).toContain(IDENTITY.orgFull);
  expect(f).toContain('Qual é a missão de hoje?');
  expect(f.split('\n').length).toBeGreaterThanOrEqual(14); // personagem medium (14 linhas)
  expect(seen.identity?.active).toBe(false); // terminou e liberou o input
});

test('terminal baixo: só texto, sem personagem, mas a resposta é a mesma', async () => {
  process.env[NO_ANIM] = '1';
  const seen: { started?: boolean; identity?: Identity } = {};
  const { frames } = render(<Harness text="quem é você" rows={15} columns={100} seen={seen} />);
  await tick();
  const f = card(frames);
  expect(f).toContain(IDENTITY.org);
  expect(f).not.toMatch(/[▀▄█]/); // sem personagem
  expect(f.split('\n').length).toBeLessThan(14); // medium sozinho já seria 14 linhas
});

test('pergunta comum não dispara a cena', async () => {
  const seen: { started?: boolean; identity?: Identity } = {};
  render(<Harness text="o que é docker?" rows={40} columns={100} seen={seen} />);
  await tick();
  expect(seen.started).toBe(false);
  expect(seen.identity?.active).toBe(false);
});

test('animada: começa em suspense (sem a fala) e o Esc pula pro final', async () => {
  delete process.env[NO_ANIM];
  const seen: { started?: boolean; identity?: Identity } = {};
  const { lastFrame, frames, stdin } = render(
    <Harness text="Quem é você?" rows={40} columns={100} seen={seen} />,
  );
  await tick(1300);
  const meio = lastFrame() ?? '';
  expect(meio).toContain('Algu');
  expect(meio).not.toContain(`Eu sou o ${IDENTITY.agent}`);
  expect(seen.identity?.active).toBe(true);

  stdin.write('\u001B');
  await tick(300);
  expect(card(frames)).toContain(`Eu sou o ${IDENTITY.agent}.`);
  expect(seen.identity?.active).toBe(false);
});
