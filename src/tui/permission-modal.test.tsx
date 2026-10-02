import { test, expect } from 'bun:test';
import React from 'react';
import { render } from 'ink-testing-library';
import { stripAnsi } from './test-utils.js';
import { PermissionModal } from './palette.js';
import type { PermissionReq } from './state.js';

const req = (command: string): PermissionReq => ({
  id: 'per_1',
  sessionId: 'ses_1',
  kind: 'bash',
  patterns: [],
  command,
  always: [],
  title: 'bash',
});

const mostrar = (command: string): string => {
  const ui = render(<PermissionModal req={req(command)} queued={1} onRespond={() => {}} />);
  return stripAnsi(ui.lastFrame() ?? '');
};

test('comando longo aparece até o fim (não é cortado em 78 colunas)', () => {
  // O perigo mora na cauda: `ls ... && rm -rf`. Cortar escondia justamente isso.
  const frame = mostrar(`ls ${'a'.repeat(120)} && rm -rf /tmp/alvo-final`);
  expect(frame).toContain('rm -rf /tmp/alvo-final');
});

test('comando acima do teto avisa quantos caracteres ficaram de fora', () => {
  const frame = mostrar(`echo ${'x'.repeat(500)}`);
  expect(frame).toMatch(/\+\d+ caracteres não exibidos/);
});
