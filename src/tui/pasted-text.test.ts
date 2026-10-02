import { test, expect } from 'bun:test';
import {
  PASTE_COALESCE_MS,
  applyPaste,
  countLines,
  createPasteStore,
  expandPastes,
  isLargePaste,
  pasteToken,
  tokenLengthAtEnd,
} from './pasted-text.js';

const lines = (n: number): string => Array.from({ length: n }, (_, i) => `linha ${i}`).join('\n');

test('limites: texto curto entra cru; 6+ linhas ou 500+ chars compacta', () => {
  expect(isLargePaste('olá')).toBe(false);
  expect(isLargePaste(lines(5))).toBe(false);
  expect(isLargePaste(lines(6))).toBe(true);
  expect(isLargePaste('x'.repeat(499))).toBe(false);
  expect(isLargePaste('x'.repeat(500))).toBe(true);
});

test('contagem ignora a quebra final e o token tem dois formatos', () => {
  expect(countLines('a\nb\n')).toBe(2);
  expect(pasteToken(1, lines(120))).toBe('[Pasted text #1 +120 lines]');
  expect(pasteToken(2, 'x'.repeat(900))).toBe('[Pasted text #2 · 900 chars]');
});

test('expandPastes: devolve o conteúdo; id desconhecido fica como está', () => {
  const contents = new Map([
    [1, 'AAA'],
    [2, 'BBB'],
  ]);
  const out = expandPastes(
    'veja [Pasted text #1 +9 lines] e [Pasted text #2 · 700 chars] e [Pasted text #7 +3 lines]',
    contents,
  );
  expect(out).toBe('veja AAA e BBB e [Pasted text #7 +3 lines]');
});

test('expandPastes: `$&` e `$1` do texto colado NÃO são interpretados como substituição', () => {
  const colado = 'preço $& e $1 e $$';
  const contents = new Map([[1, colado]]);
  expect(expandPastes('[Pasted text #1 · 600 chars]', contents)).toBe(colado);
});

test('applyPaste: texto pequeno não é colagem (null) e não toca no store', () => {
  const store = createPasteStore();
  expect(applyPaste(store, 'ab', 2, 'curto', null, 0)).toBeNull();
  expect(store.has(1)).toBe(false);
});

test('applyPaste: colagem grande vira token no cursor, mantendo o resto do texto', () => {
  const store = createPasteStore();
  const r = applyPaste(store, 'antes depois', 6, lines(50), null, 1_000)!;
  expect(r.value).toBe('antes [Pasted text #1 +50 lines]depois');
  expect(r.cursor).toBe('antes [Pasted text #1 +50 lines]'.length);
  expect(expandPastes(r.value, store.take())).toBe(`antes ${lines(50)}depois`);
});

test('applyPaste: chunks seguidos da mesma colagem viram UM token, inclusive o último pequeno', () => {
  const store = createPasteStore();
  const a = applyPaste(store, '', 0, lines(40) + '\n', null, 1_000)!;
  const b = applyPaste(store, a.value, a.cursor, lines(30) + '\n', a.last, 1_000 + 10)!;
  const c = applyPaste(store, b.value, b.cursor, 'fim', b.last, 1_000 + 20)!; // pedaço pequeno
  expect(c.value).toMatch(/^\[Pasted text #1 \+\d+ lines\]$/);
  expect(c.value).not.toContain('#2');
  expect(expandPastes(c.value, store.take())).toBe(lines(40) + '\n' + lines(30) + '\n' + 'fim');
});

test('applyPaste: passada a janela, a colagem seguinte é outra (#2)', () => {
  const store = createPasteStore();
  const a = applyPaste(store, '', 0, lines(10), null, 1_000)!;
  const b = applyPaste(store, a.value, a.cursor, lines(10), a.last, 1_000 + PASTE_COALESCE_MS + 1)!;
  expect(b.value).toContain('#1');
  expect(b.value).toContain('#2');
});

test('applyPaste: se o token anterior saiu do cursor (usuário editou), não funde', () => {
  const store = createPasteStore();
  const a = applyPaste(store, '', 0, lines(10), null, 1_000)!;
  const editado = a.value.slice(0, -1) + 'x'; // quebrou o token
  const b = applyPaste(store, editado, editado.length, 'oi', a.last, 1_010);
  expect(b).toBeNull();
});

test('take zera o store e a numeração recomeça', () => {
  const store = createPasteStore();
  store.add('um');
  expect(store.take().size).toBe(1);
  expect(store.add('dois')).toBe(1);
});

test('tokenLengthAtEnd: só reconhece token colado no fim do trecho antes do cursor', () => {
  const t = '[Pasted text #3 +12 lines]';
  expect(tokenLengthAtEnd(`oi ${t}`)).toBe(t.length);
  expect(tokenLengthAtEnd(`${t} oi`)).toBe(0);
  expect(tokenLengthAtEnd('[Pasted text #3 +12 lines')).toBe(0);
});
