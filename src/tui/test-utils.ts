/**
 * Helpers de teste da TUI. `ink-testing-library` renderiza de forma síncrona,
 * mas o Ink agenda a pintura — sob carga (CI lotado, várias coisas rodando) o
 * `.lastFrame()` logo depois de um `render()`/`stdin.write()` pode pegar um frame
 * intermediário. `waitForFrame` faz polling até a asserção passar ou estourar.
 */
import React from 'react';
import { render } from 'ink-testing-library';

/**
 * Tira os códigos ANSI do frame. Sob um TTY real (`bun test` no terminal, sem
 * pipe) o Ink pinta com cor e o cursor sai como `<Text inverse>` no meio da
 * string — o que quebra `.toContain('hello')`. Piped/CI o Ink já manda texto
 * puro. Normalizar aqui deixa os testes iguais nos dois cenários.
 */
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;
export const stripAnsi = (s: string | undefined): string => (s ?? '').replace(ANSI, '');

/** Espera `predicate(frame())` virar true (ou lança após `timeoutMs`). ANSI já removido. */
export async function waitForFrame(
  frame: () => string | undefined,
  predicate: (f: string) => boolean,
  { timeoutMs = 2000, intervalMs = 10 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let last = stripAnsi(frame());
  while (Date.now() < deadline) {
    last = stripAnsi(frame());
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `waitForFrame: condição não bateu em ${timeoutMs}ms.\n─── último frame ───\n${last}\n────────────────────`,
  );
}

/** Açúcar: espera o frame conter todas as strings de `needles`. */
export function waitForText(
  frame: () => string | undefined,
  needles: string | string[],
  opts?: { timeoutMs?: number; intervalMs?: number },
): Promise<string> {
  const list = Array.isArray(needles) ? needles : [needles];
  return waitForFrame(frame, (f) => list.every((n) => f.includes(n)), opts);
}

/** Renderiza um componente e devolve o frame já assentado (espera pintura estável). */
export async function frameOf(el: React.ReactElement): Promise<string> {
  const { lastFrame } = render(el);
  // deixa o Ink terminar a 1ª pintura (throttle interno de render)
  await new Promise((r) => setTimeout(r, 25));
  return stripAnsi(lastFrame());
}
