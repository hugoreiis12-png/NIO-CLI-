/**
 * Cena "Quem é você?": suspense digitada → o personagem se forma → o NIO se
 * apresenta. Roda 100% local (não vai pro modelo): é instantânea, não gasta
 * token e a resposta não depende de o LLM acertar a identidade.
 *
 * Ao terminar, a composição final é gravada acima da área dinâmica com
 * `useStdout().write` — o Ink só aceita UM `<Static>` por árvore e ele já é do
 * histórico do chat. Ao vivo e no scrollback saem da mesma `cardLines`.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import chalk from 'chalk';
import { ANIM } from '../avatar.js';
import { theme } from './theme.js';
import { avatarLines, avatarWidth, motionAllowed, type AvatarSize } from './avatar-view.js';
import { REVEAL_MS, isIdentityQuestion, revealAt, type RevealView } from './identity.js';

type Size = AvatarSize | 'none';

interface Entry {
  question: string;
  size: Size;
  columns: number;
}

/** Medium (14 linhas) só com folga de tela; senão o ícone; senão só texto. */
export function spriteSize(rows: number, columns: number): Size {
  if (rows >= 30 && columns >= 64) return 'medium';
  if (rows >= 22 && columns >= 40) return 'icon';
  return 'none';
}

/** Estado final sem a suspense — é o que fica no scrollback. */
const FINAL: RevealView = { ...revealAt(REVEAL_MS), suspense: [] };

const GUTTER = 2;
const MARGIN = 1;

/** Quebra por palavra em `width` colunas (texto sem ANSI). */
function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const word of text.split(' ')) {
    if (cur && cur.length + 1 + word.length > width) {
      lines.push(cur);
      cur = word;
    } else {
      cur = cur ? `${cur} ${word}` : word;
    }
  }
  return cur ? [...lines, cur] : lines;
}

function speechLines(spoken: string[], width: number): string[] {
  return spoken.flatMap((line, k) =>
    wrap(line, width).map((l) =>
      k === 0 ? chalk.bold[theme.accentBright](l) : chalk[theme.text](l),
    ),
  );
}

const pad = (s: string, n: number): string => `${s}${' '.repeat(Math.max(0, n))}`;

/** A cena inteira como linhas de terminal (com margem). Fonte única ao vivo e no scrollback. */
export function cardLines(entry: Entry, view: RevealView): string[] {
  const out = [chalk[theme.user](`› ${entry.question}`)];
  for (const line of view.suspense) out.push(chalk[theme.dim](line));

  const { sprite } = view;
  if (!sprite || entry.size === 'none') {
    out.push(...speechLines(view.spoken, entry.columns - 2 * MARGIN));
  } else {
    const artW = avatarWidth(entry.size);
    const g = sprite.kind === 'hold' && view.done ? ANIM.settleSeed : sprite.i;
    const art = avatarLines({ kind: sprite.kind, pose: 'idle' }, sprite.i, g, entry.size);
    const speech = speechLines(view.spoken, entry.columns - 2 * MARGIN - artW - GUTTER);
    const top = Math.max(0, Math.floor((art.length - speech.length) / 2));
    out.push('');
    for (let r = 0; r < Math.max(art.length, speech.length); r++) {
      const left = art[r] ?? '';
      const visible = r < art.length ? artW : 0;
      out.push(
        `${pad(left, artW - visible)}${' '.repeat(GUTTER)}${speech[r - top] ?? ''}`.trimEnd(),
      );
    }
  }
  return out.map((l) => ' '.repeat(MARGIN) + l);
}

function Reveal({ entry, onDone }: { entry: Entry; onDone: () => void }): React.ReactElement {
  const [t, setT] = useState(motionAllowed() ? 0 : REVEAL_MS);
  const finished = t >= REVEAL_MS;
  const doneRef = useRef(onDone); // onDone muda a cada render; só a transição pra "fim" importa
  doneRef.current = onDone;
  useEffect(() => {
    if (finished) return;
    const id = setInterval(() => setT((x) => x + ANIM.frameMs), ANIM.frameMs);
    return () => clearInterval(id);
  }, [finished]);
  useInput((_, key) => {
    if (key.escape) setT(REVEAL_MS);
  });
  useEffect(() => {
    if (finished) doneRef.current();
  }, [finished]);
  return (
    <Box marginY={1}>
      <Text>{cardLines(entry, revealAt(t)).join('\n')}</Text>
    </Box>
  );
}

export interface Identity {
  /** `true` se o texto era "quem é você?" e a cena começou (não mande ao modelo). */
  tryStart: (text: string) => boolean;
  /** Cena em curso — o input deve ficar desabilitado. */
  active: boolean;
  node: React.ReactElement | null;
}

export function useIdentity(rows: number, columns: number): Identity {
  const { write } = useStdout();
  const [current, setCurrent] = useState<Entry | null>(null);
  const finish = (entry: Entry): void => {
    write(`\n${cardLines(entry, FINAL).join('\n')}\n\n`);
    setCurrent(null);
  };
  return {
    tryStart: (text) => {
      if (!isIdentityQuestion(text)) return false;
      setCurrent({ question: text.trim(), size: spriteSize(rows, columns), columns });
      return true;
    },
    active: current !== null,
    node: current && <Reveal entry={current} onDone={() => finish(current)} />,
  };
}
