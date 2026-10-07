/**
 * Personagem NIO dentro do Ink. Consome o script de `avatar.ts` (CYCLE/buildFrame)
 * sem alterá-lo e desenha com meio-bloco (▀ ▄): cada caractere carrega 2 pixels
 * na vertical, então o sprite de 28 linhas vira 14 (medium) ou 7 (icon).
 */
import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';
import { envName } from '../brand.js';
import {
  ANIM,
  CYCLE,
  PALETTE,
  SPRITE_H,
  buildFrame,
  stepFrames,
  type Canvas,
  type Step,
} from '../avatar.js';

export type AvatarSize = 'icon' | 'medium';

/** Largura do quadro em pixels: sprite (20) + 1 de folga por lado. */
const FRAME_COLS = 22;
/** Intervalo do tick do spinner do App (`setFrame` a cada 90 ms). */
const APP_TICK_MS = 90;
/** Linhas de terminal do ícone: sprite de 28 px reduzido 2×2 e pintado em meio-bloco. */
export const ICON_ROWS = SPRITE_H / 4;
/**
 * Abaixo disso o ícone não cabe junto do chrome da sessão (área viva + status +
 * input + rodapé). Acima de 24 de propósito: 24 é o fallback de `useTerminalSize`
 * quando o stdout não informa altura — tamanho suposto não ganha 7 linhas de sprite.
 */
export const MIN_TERMINAL_ROWS = 26;
/** Portão único de altura — o App desconta `ICON_ROWS` da área viva quando ele passa. */
export const avatarFits = (rows: number): boolean => rows >= MIN_TERMINAL_ROWS;

type Pixel = string | null;
interface Run {
  text: string;
  fg?: string;
  bg?: string;
}

const CYCLE_LEN = CYCLE.reduce((n, s) => n + stepFrames(s), 0);

/** Quadro global `g` → passo do ciclo + índice dentro dele (dá a volta sozinho). */
export function stepAt(g: number): { step: Step; i: number } {
  let k = ((g % CYCLE_LEN) + CYCLE_LEN) % CYCLE_LEN;
  for (const step of CYCLE) {
    const n = stepFrames(step);
    if (k < n) return { step, i: k };
    k -= n;
  }
  return { step: CYCLE[0] as Step, i: 0 };
}

/** Animação desligada (CI ou NIO_NO_ANIM): mesma regra do `avatar.ts`. */
export function motionAllowed(): boolean {
  return !process.env.CI && !process.env[envName('NO_ANIM')];
}

function pixelsOf(cv: Canvas): Pixel[][] {
  return cv.cells.map((row) => row.map((c) => (c.tone ? PALETTE[c.tone].hex : null)));
}

/** Reduz 2×2 → 1: sólido vence glifo (a silhueta não some), glifo vence vazio. */
function halve(px: Pixel[][]): Pixel[][] {
  const out: Pixel[][] = [];
  for (let r = 0; r < px.length; r += 2) {
    const line: Pixel[] = [];
    for (let c = 0; c < (px[r]?.length ?? 0); c += 2) {
      const block = [px[r]?.[c], px[r]?.[c + 1], px[r + 1]?.[c], px[r + 1]?.[c + 1]];
      line.push(block.find((p) => p) ?? null);
    }
    out.push(line);
  }
  return out;
}

function cellOf(top: Pixel, bottom: Pixel): Run {
  if (top && bottom)
    return top === bottom ? { text: '█', fg: top } : { text: '▀', fg: top, bg: bottom };
  if (top) return { text: '▀', fg: top };
  if (bottom) return { text: '▄', fg: bottom };
  return { text: ' ' };
}

/** Pares de linhas → linhas de terminal, juntando caracteres vizinhos de mesma cor. */
export function halfBlockRows(px: Pixel[][]): Run[][] {
  const rows: Run[][] = [];
  for (let r = 0; r < px.length; r += 2) {
    const runs: Run[] = [];
    const width = px[r]?.length ?? 0;
    for (let c = 0; c < width; c++) {
      const cell = cellOf(px[r]?.[c] ?? null, px[r + 1]?.[c] ?? null);
      const last = runs[runs.length - 1];
      if (last && last.fg === cell.fg && last.bg === cell.bg) last.text += cell.text;
      else runs.push(cell);
    }
    rows.push(runs);
  }
  return rows;
}

function paint({ text, fg, bg }: Run): string {
  if (!fg && !bg) return text;
  let c = chalk;
  if (fg) c = c.hex(fg);
  if (bg) c = c.bgHex(bg);
  return c(text);
}

/** Colunas de terminal que o personagem ocupa (1 pixel = 1 coluna; o ícone é 2×2 menor). */
export const avatarWidth = (size: AvatarSize): number =>
  size === 'icon' ? FRAME_COLS / 2 : FRAME_COLS;

/** Quadro pronto pra terminal: uma string colorida por linha. */
export function avatarLines(step: Step, i: number, g: number, size: AvatarSize): string[] {
  const px = pixelsOf(buildFrame(step, i, g, FRAME_COLS * 2, SPRITE_H));
  return halfBlockRows(size === 'icon' ? halve(px) : px).map((runs) => runs.map(paint).join(''));
}

export function AvatarFrame({
  step,
  i,
  g,
  size,
}: {
  step: Step;
  i: number;
  g: number;
  size: AvatarSize;
}): React.ReactElement {
  const text = useMemo(() => avatarLines(step, i, g, size).join('\n'), [step, i, g, size]);
  return (
    <Box>
      <Text>{text}</Text>
    </Box>
  );
}

/**
 * Ícone acima do status. Fica de pé o turno inteiro (quem decide é o `active` do
 * App); some em terminal baixo — nunca empurra o input pra fora da tela.
 */
export function ThinkingAvatar({
  active,
  frame,
  rows,
}: {
  active: boolean;
  frame: number;
  rows: number;
}): React.ReactElement | null {
  if (!active || !avatarFits(rows)) return null;
  const g = motionAllowed() ? Math.floor((frame * APP_TICK_MS) / ANIM.frameMs) : ANIM.settleSeed;
  const { step, i } = motionAllowed()
    ? stepAt(g)
    : { step: { kind: 'hold', pose: 'idle' } as Step, i: 0 };
  return (
    <Box paddingX={1}>
      <AvatarFrame step={step} i={i} g={g} size="icon" />
    </Box>
  );
}
