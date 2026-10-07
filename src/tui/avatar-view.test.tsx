import { test, expect } from 'bun:test';
import React from 'react';
import { render } from 'ink-testing-library';
import { CYCLE, stepFrames, type Step } from '../avatar.js';
import {
  AvatarFrame,
  ICON_ROWS,
  MIN_TERMINAL_ROWS,
  ThinkingAvatar,
  avatarFits,
  halfBlockRows,
  stepAt,
} from './avatar-view.js';

const lines = (frame: string | undefined): string[] => (frame ?? '').split('\n');

test('stepAt: cobre o ciclo inteiro e dá a volta', () => {
  const total = CYCLE.reduce((n, s) => n + stepFrames(s), 0);
  expect(stepAt(0).step).toEqual(CYCLE[0] as Step);
  expect(stepAt(total)).toEqual(stepAt(0));
  expect(stepAt(-1)).toEqual(stepAt(total - 1));
  for (let g = 0; g < total; g++) expect(stepAt(g).i).toBeLessThan(stepFrames(stepAt(g).step));
});

test('halfBlockRows: 2 pixels por caractere, vizinhos de mesma cor se fundem', () => {
  const rows = halfBlockRows([
    ['#111', '#111', null],
    ['#111', '#222', null],
  ]);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toEqual([
    { text: '█', fg: '#111' },
    { text: '▀', fg: '#111', bg: '#222' },
    { text: ' ' },
  ]);
});

test('AvatarFrame: icon = 7 linhas, medium = 14 (sprite de 28 em meio-bloco)', () => {
  const step = { kind: 'hold', pose: 'idle' } as const;
  const icon = render(<AvatarFrame step={step} i={0} g={0} size="icon" />);
  const medium = render(<AvatarFrame step={step} i={0} g={0} size="medium" />);
  expect(lines(icon.lastFrame())).toHaveLength(7);
  expect(lines(medium.lastFrame())).toHaveLength(14);
});

test('ThinkingAvatar: aparece com `active` e com terminal alto o bastante', () => {
  expect(render(<ThinkingAvatar active frame={5} rows={40} />).lastFrame()).not.toBe('');
  expect(render(<ThinkingAvatar active={false} frame={5} rows={40} />).lastFrame()).toBe('');
  expect(render(<ThinkingAvatar active frame={5} rows={20} />).lastFrame()).toBe('');
});

test('o portão de altura cabe num terminal de 30 linhas (o do time)', () => {
  // Regressão: com MIN_TERMINAL_ROWS=32 o personagem nunca aparecia em 30 linhas.
  expect(avatarFits(30)).toBe(true);
  expect(avatarFits(MIN_TERMINAL_ROWS)).toBe(true);
  expect(avatarFits(MIN_TERMINAL_ROWS - 1)).toBe(false);
  expect(render(<ThinkingAvatar active frame={5} rows={30} />).lastFrame()).not.toBe('');
});

test('altura desconhecida (fallback 24 do App) não desenha o personagem', () => {
  // Regressão: com o portão em 24 o sprite entrava em TODO teste da App (stdout
  // sem `rows`), encolhia a área viva pra 3 linhas e embaralhava o layout.
  expect(avatarFits(24)).toBe(false);
  expect(render(<ThinkingAvatar active frame={5} rows={24} />).lastFrame()).toBe('');
});

test('ICON_ROWS é a altura real do ícone — é o que o App desconta da área viva', () => {
  const step = { kind: 'hold', pose: 'idle' } as const;
  const icon = render(<AvatarFrame step={step} i={0} g={0} size="icon" />);
  expect(lines(icon.lastFrame())).toHaveLength(ICON_ROWS);
});

test('o ícone mais a área viva mínima caber no menor terminal aceito', () => {
  // 3 linhas de área viva (o piso do liveMax) + status + input + rodapé.
  const CHROME = 3 + 1 + 3 + 2;
  expect(ICON_ROWS + CHROME).toBeLessThanOrEqual(MIN_TERMINAL_ROWS);
});
