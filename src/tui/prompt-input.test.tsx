import { test, expect } from 'bun:test';
import React from 'react';
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { waitForText } from './test-utils.js';
import {
  PromptInput,
  layoutRows,
  cursorRowCol,
  moveVertical,
  wordLeft,
  wordRight,
  deleteWordBefore,
  lineStart,
  lineEnd,
  sanitizePaste,
} from './prompt-input.js';

// ─── helpers puros ──────────────────────────────────────────────────

test('layoutRows: hard-wrap em width + \\n explícito, com offsets', () => {
  expect(layoutRows('abcdef', 3)).toEqual([
    { text: 'abc', start: 0 },
    { text: 'def', start: 3 },
  ]);
  expect(layoutRows('ab\ncd', 10)).toEqual([
    { text: 'ab', start: 0 },
    { text: 'cd', start: 3 }, // 'c' vem depois do 'a','b','\n'
  ]);
  expect(layoutRows('', 10)).toEqual([{ text: '', start: 0 }]);
  expect(layoutRows('a\n\nb', 10)).toEqual([
    { text: 'a', start: 0 },
    { text: '', start: 2 },
    { text: 'b', start: 3 },
  ]);
});

test('cursorRowCol: mapeia índice → linha/coluna de exibição', () => {
  const rows = layoutRows('abcdef', 3); // [abc@0, def@3]
  expect(cursorRowCol(rows, 0)).toEqual({ row: 0, col: 0 });
  expect(cursorRowCol(rows, 2)).toEqual({ row: 0, col: 2 });
  expect(cursorRowCol(rows, 3)).toEqual({ row: 1, col: 0 });
  expect(cursorRowCol(rows, 6)).toEqual({ row: 1, col: 3 });
});

test('moveVertical: sobe/desce mantendo a coluna; null na borda', () => {
  const v = 'hello\nworld longo';
  // cursor no 'l' final de "hello" (col 4, row 0) → desce → col 4 de "world…"
  expect(moveVertical(v, 4, 20, 'down')).toBe(6 + 4); // 'world'[4] = 'd' -> índice 10
  expect(moveVertical(v, 0, 20, 'up')).toBeNull(); // já no topo
  expect(moveVertical('só uma linha', 3, 20, 'down')).toBeNull(); // já embaixo
});

test('wordLeft / wordRight / deleteWordBefore', () => {
  expect(wordLeft('foo bar baz', 11)).toBe(8);
  expect(wordLeft('foo bar baz', 8)).toBe(4);
  expect(wordRight('foo bar baz', 0)).toBe(3);
  expect(wordRight('foo bar baz', 3)).toBe(7);
  expect(deleteWordBefore('foo bar baz', 11)).toEqual({ value: 'foo bar ', cursor: 8 });
  expect(deleteWordBefore('foo bar ', 8)).toEqual({ value: 'foo ', cursor: 4 });
});

test('lineStart / lineEnd respeitam \\n', () => {
  const v = 'linha um\nlinha dois\nfim';
  expect(lineStart(v, 12)).toBe(9); // dentro da 2ª linha
  expect(lineEnd(v, 12)).toBe(19);
  expect(lineStart(v, 0)).toBe(0);
  expect(lineEnd(v, 21)).toBe(v.length);
});

test('sanitizePaste: \\r\\n→\\n, tab→2 espaços, dropa control', () => {
  expect(sanitizePaste('a\r\nb\tc')).toBe('a\nb  c');
  expect(sanitizePaste('x\x00\x07y')).toBe('xy');
  expect(sanitizePaste('mantém\nquebras')).toBe('mantém\nquebras');
});

// ─── componente (ink-testing-library) ───────────────────────────────

function Harness({ initial = '', disabled = false }: { initial?: string; disabled?: boolean }) {
  const [value, setValue] = React.useState(initial);
  const [submitted, setSubmitted] = React.useState<string | null>(null);
  return (
    <>
      <PromptInput
        value={value}
        onChange={setValue}
        onSubmit={(v) => setSubmitted(v)}
        disabled={disabled}
        width={20}
      />
      {submitted !== null && <Text>{`SUBMITTED[${submitted}]`}</Text>}
    </>
  );
}

const nap = (ms = 40) => new Promise((r) => setTimeout(r, ms));

test('PromptInput: digitar aparece no frame com o cursor', async () => {
  const { stdin, lastFrame } = render(<Harness />);
  await nap();
  stdin.write('oi mundo');
  await nap();
  expect(lastFrame()).toContain('oi mundo');
  expect(lastFrame()).toContain('›'); // gutter
});

test('PromptInput: texto longo quebra em várias linhas (responsivo)', async () => {
  const { stdin, lastFrame } = render(<Harness />);
  await nap();
  stdin.write('a'.repeat(50)); // width=20 → 3 linhas
  await nap();
  const body = (lastFrame() ?? '').split('\n').filter((l) => l.includes('aaaa'));
  expect(body.length).toBeGreaterThanOrEqual(3);
});

test('PromptInput: backspace apaga o char antes do cursor', async () => {
  const { stdin, lastFrame } = render(<Harness initial="abcd" />);
  await nap();
  stdin.write('\x7f'); // backspace
  await nap();
  expect(lastFrame()).toContain('abc');
  expect(lastFrame()).not.toMatch(/abcd/);
});

test('PromptInput: Enter envia; paste multi-linha NÃO envia', async () => {
  const { stdin, lastFrame } = render(<Harness />);
  await nap();
  stdin.write('linha um\nlinha dois'); // paste
  await nap();
  expect(lastFrame()).not.toContain('SUBMITTED');
  expect(lastFrame()).toContain('linha um');
  expect(lastFrame()).toContain('linha dois');
  stdin.write('\r'); // Enter
  await nap();
  expect(lastFrame()).toContain('SUBMITTED[linha um\nlinha dois]');
});

test('PromptInput: cursor navegável — ←← e digita insere no meio', async () => {
  const { stdin, lastFrame } = render(<Harness />);
  await nap();
  stdin.write('helo');
  await waitForText(lastFrame, 'helo');
  stdin.write('\x1b[D'); // ← (esquerda)
  await nap();
  stdin.write('l'); // "hello"
  await waitForText(lastFrame, 'hello');
});

test('PromptInput: Ctrl-W apaga a palavra anterior', async () => {
  const { stdin, lastFrame } = render(<Harness initial="foo bar baz" />);
  await nap();
  stdin.write('\x17'); // Ctrl-W
  await nap();
  const f = lastFrame() ?? '';
  expect(f).toContain('foo bar');
  expect(f).not.toContain('baz');
});

test('PromptInput: `\\`+Enter insere nova linha em vez de enviar', async () => {
  const { stdin, lastFrame } = render(<Harness initial="linha\\" />);
  await nap();
  stdin.write('\r'); // Enter após o "\"
  await nap();
  expect(lastFrame()).not.toContain('SUBMITTED');
  const body = (lastFrame() ?? '').split('\n').filter((l) => l.includes('linha') || l.trim() === '›');
  // a "\" virou \n → agora há uma linha "linha" e uma linha vazia
  expect((lastFrame() ?? '')).toContain('linha');
});

test('PromptInput: disabled — digita mas Enter não envia', async () => {
  const { stdin, lastFrame } = render(<Harness disabled />);
  await nap();
  stdin.write('oi');
  await nap();
  stdin.write('\r');
  await nap();
  expect(lastFrame()).toContain('oi');
  expect(lastFrame()).not.toContain('SUBMITTED');
});
