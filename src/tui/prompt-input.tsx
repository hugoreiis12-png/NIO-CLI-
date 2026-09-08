/**
 * Editor de linha do chat (Sprint 1 de UI/UX). Substitui o `useInput` cru do Ink
 */
import React from 'react';
import { Box, Text, useInput } from 'ink';
import { theme, sym } from './theme.js';

// ─── helpers puros (testados em prompt-input.test.tsx, sem React) ────────────

/** Quebra `value` em linhas de exibição (hard-wrap em `width`), com o offset de
 *  cada linha dentro de `value`. `\n` explícito começa linha nova. */
export function layoutRows(value: string, width: number): { text: string; start: number }[] {
  const w = Math.max(1, width);
  const rows: { text: string; start: number }[] = [];
  let offset = 0;
  for (const seg of value.split('\n')) {
    if (seg.length === 0) {
      rows.push({ text: '', start: offset });
    } else {
      for (let j = 0; j < seg.length; j += w) rows.push({ text: seg.slice(j, j + w), start: offset + j });
    }
    offset += seg.length + 1; // +1 pelo '\n'
  }
  return rows;
}

/** Linha/coluna de exibição do cursor. */
export function cursorRowCol(
  rows: { text: string; start: number }[],
  cursor: number,
): { row: number; col: number } {
  let row = 0;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]!.start <= cursor) row = i;
    else break;
  }
  return { row, col: cursor - (rows[row]?.start ?? 0) };
}

/** Move o cursor uma linha pra cima/baixo mantendo a coluna. `null` = já está na
 *  borda (o caller trata como navegação de paleta / histórico). */
export function moveVertical(
  value: string,
  cursor: number,
  width: number,
  dir: 'up' | 'down',
): number | null {
  const rows = layoutRows(value, width);
  const { row, col } = cursorRowCol(rows, cursor);
  const target = dir === 'up' ? row - 1 : row + 1;
  if (target < 0 || target >= rows.length) return null;
  const r = rows[target]!;
  return r.start + Math.min(col, r.text.length);
}

const isWs = (ch: string | undefined): boolean => !!ch && /\s/.test(ch);

export function wordLeft(value: string, cursor: number): number {
  let i = cursor;
  while (i > 0 && isWs(value[i - 1])) i--;
  while (i > 0 && !isWs(value[i - 1])) i--;
  return i;
}
export function wordRight(value: string, cursor: number): number {
  let i = cursor;
  while (i < value.length && isWs(value[i])) i++;
  while (i < value.length && !isWs(value[i])) i++;
  return i;
}
export function deleteWordBefore(value: string, cursor: number): { value: string; cursor: number } {
  const i = wordLeft(value, cursor);
  return { value: value.slice(0, i) + value.slice(cursor), cursor: i };
}

export function lineStart(value: string, cursor: number): number {
  const nl = value.lastIndexOf('\n', cursor - 1);
  return nl < 0 ? 0 : nl + 1;
}
export function lineEnd(value: string, cursor: number): number {
  const nl = value.indexOf('\n', cursor);
  return nl < 0 ? value.length : nl;
}

/** Normaliza texto colado: `\r\n?`→`\n`, tab→2 espaços, remove outros control. */
export function sanitizePaste(input: string): string {
  return Array.from(input.replace(/\r\n?/g, '\n').replace(/\t/g, '  '))
    .filter((ch) => ch === '\n' || ch >= ' ')
    .join('');
}

// ─── componente ─────────────────────────────────────────────────────────────

export interface PromptInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  /** Enquanto `true` (paleta aberta): ↑/↓/Enter/Esc vão pro `onNav`, o resto edita. */
  navCapture?: boolean;
  onNav?: (dir: 'up' | 'down' | 'submit' | 'cancel') => void;
  /** Sprint 5: Tab (ou Shift-Tab) — o App cicla o modo do agente. */
  onTab?: (reverse: boolean) => void;
  disabled?: boolean;
  /** `false` = não captura teclado (um overlay está por cima). Default `true`. */
  active?: boolean;
  /** colunas disponíveis pro texto (o pai calcula descontando borda/sidebar). */
  width: number;
  maxRows?: number;
  placeholder?: string;
  borderColor?: string;
}

export function PromptInput({
  value,
  onChange,
  onSubmit,
  navCapture = false,
  onNav,
  onTab,
  disabled = false,
  active = true,
  width,
  maxRows = 6,
  placeholder = '',
  borderColor = theme.accent,
}: PromptInputProps): React.ReactElement {
  const [cursor, setCursor] = React.useState(value.length);
  // o pai pode zerar/encolher `value` (ex.: após enviar) — reancora o cursor.
  React.useEffect(() => {
    setCursor((c) => Math.min(c, value.length));
  }, [value.length]);

  const wrapW = Math.max(8, width);
  const edit = (nextValue: string, nextCursor: number): void => {
    onChange(nextValue);
    setCursor(Math.max(0, Math.min(nextCursor, nextValue.length)));
  };
  const insert = (text: string): void =>
    edit(value.slice(0, cursor) + text + value.slice(cursor), cursor + text.length);

  useInput((input, key) => {
    // ── paleta aberta: navegação vai pro pai; edição segue normal ──
    if (navCapture) {
      if (key.upArrow) return onNav?.('up');
      if (key.downArrow) return onNav?.('down');
      if (key.return) return onNav?.('submit');
      if (key.escape) return onNav?.('cancel');
    }

    // ── movimento ──
    if (key.leftArrow) {
      return setCursor((c) => (key.meta || key.ctrl ? wordLeft(value, c) : Math.max(0, c - 1)));
    }
    if (key.rightArrow) {
      return setCursor((c) => (key.meta || key.ctrl ? wordRight(value, c) : Math.min(value.length, c + 1)));
    }
    if (key.upArrow) {
      const n = moveVertical(value, cursor, wrapW, 'up');
      return n === null ? onNav?.('up') : setCursor(n);
    }
    if (key.downArrow) {
      const n = moveVertical(value, cursor, wrapW, 'down');
      return n === null ? undefined : setCursor(n);
    }

    // ── atalhos de edição ──
    if (key.ctrl && input === 'a') return setCursor(lineStart(value, cursor));
    if (key.ctrl && input === 'e') return setCursor(lineEnd(value, cursor));
    if (key.ctrl && input === 'w') {
      const r = deleteWordBefore(value, cursor);
      return edit(r.value, r.cursor);
    }
    if (key.ctrl && input === 'u') {
      const s = lineStart(value, cursor);
      return edit(value.slice(0, s) + value.slice(cursor), s);
    }
    if (key.ctrl && input === 'k') {
      const e = lineEnd(value, cursor);
      return edit(value.slice(0, cursor) + value.slice(e), cursor);
    }
    if (key.ctrl && input === 'j') return insert('\n');

    if (key.backspace || key.delete) {
      if (cursor === 0) return;
      return edit(value.slice(0, cursor - 1) + value.slice(cursor), cursor - 1);
    }

    if (key.return) {
      // `\` no fim → nova linha (convenção do opencode), senão envia.
      if (value.slice(0, cursor).endsWith('\\')) {
        return edit(value.slice(0, cursor - 1) + '\n' + value.slice(cursor), cursor);
      }
      if (disabled) return; // deixa o texto pronto; envia quando desbloquear
      return onSubmit(value.trim());
    }

    if (key.escape) return; // fora da paleta o Esc é do App (abortar)
    if (key.tab) return onTab?.(key.shift ?? false); // Sprint 5: cicla o modo
    if (key.ctrl || key.meta) return;

    const text = sanitizePaste(input);
    if (text) insert(text);
  }, { isActive: active });

  // ── render ──
  const rows = layoutRows(value, wrapW);
  if (rows.length === 0) rows.push({ text: '', start: 0 });
  const { row: curRow, col: curCol } = cursorRowCol(rows, Math.min(cursor, value.length));

  let first = 0;
  if (rows.length > maxRows) first = Math.max(0, Math.min(curRow - maxRows + 1, rows.length - maxRows));
  const visible = rows.slice(first, first + maxRows);

  const gutterColor = disabled || !active ? theme.dim : theme.accent;
  const showPlaceholder = value.length === 0 && placeholder;

  return (
    <Box flexDirection="column">
      <Box
        flexDirection="column"
        width={wrapW + 6}
        borderStyle="round"
        borderColor={!active ? theme.dim : borderColor}
        paddingX={1}
      >
        {visible.map((r, i) => {
          const rowIdx = first + i;
          const gutter = rowIdx === 0 ? `${sym.chevron} ` : '  ';
          const onCursor = rowIdx === curRow && !navCapture && active;
          return (
            <Text key={rowIdx} wrap="truncate-end">
              <Text color={gutterColor}>{gutter}</Text>
              {onCursor ? (
                <>
                  <Text>{r.text.slice(0, curCol)}</Text>
                  <Text inverse>{r.text[curCol] ?? ' '}</Text>
                  <Text>{r.text.slice(curCol + 1)}</Text>
                </>
              ) : (
                <Text>{r.text || (showPlaceholder && rowIdx === 0 ? '' : ' ')}</Text>
              )}
              {showPlaceholder && rowIdx === 0 && <Text color={theme.dim}>{placeholder}</Text>}
            </Text>
          );
        })}
      </Box>
      {rows.length > maxRows && (
        <Text color={theme.dim}>
          {'  '}
          {first > 0 ? `↑ ${first}` : ''}
          {first > 0 && first + maxRows < rows.length ? ' · ' : ''}
          {first + maxRows < rows.length ? `↓ ${rows.length - first - maxRows}` : ''}
          {' linha(s) fora de vista'}
        </Text>
      )}
    </Box>
  );
}
