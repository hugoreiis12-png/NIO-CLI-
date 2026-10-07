import { test, expect } from 'bun:test';
import React from 'react';
import { render } from 'ink-testing-library';
import { CYCLE, stepFrames, type Step } from '../avatar.js';
import { AvatarFrame, ThinkingAvatar, halfBlockRows, stepAt } from './avatar-view.js';

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

test('ThinkingAvatar: aparece só pensando e com terminal alto o bastante', () => {
  expect(render(<ThinkingAvatar active frame={5} rows={40} />).lastFrame()).not.toBe('');
  expect(render(<ThinkingAvatar active={false} frame={5} rows={40} />).lastFrame()).toBe('');
  expect(render(<ThinkingAvatar active frame={5} rows={20} />).lastFrame()).toBe('');
});
