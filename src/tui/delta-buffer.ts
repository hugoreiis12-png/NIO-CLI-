/**
 * Coalescing dos deltas de token do motor.
 *
 * O motor emite `message.part.delta` por token — 895 numa resposta média, contra 7
 * snapshots `message.part.updated`. A TUI descartava os deltas e renderizava só os
 * snapshots: o texto (e o painel de raciocínio) andava em 7 saltos, e com um modelo
 * de reasoning isso é um minuto de tela parada enquanto tokens chegam.
 *
 * Consumir delta a delta resolveria a fluidez e criaria outro problema: cada
 * `setState` do Ink redesenha a árvore inteira no terminal, que é ordens de
 * magnitude mais lento que um diff de DOM. 895 renders por resposta não se pagam.
 *
 * Daí o padrão: o delta entra num buffer na hora, e o render sai no máximo uma vez
 * por janela de `DELTA_FLUSH_MS`. Fronteira terminal (idle, erro, permissão) chama
 * `flushNow()` — sem isso os últimos tokens ficariam presos no buffer.
 */
import type { PartDelta } from './state.js';

/** ~30 fps. Acima disso o terminal não acompanha; abaixo, o texto volta a saltar. */
export const DELTA_FLUSH_MS = 33;

export interface DeltaBuffer {
  /** Enfileira um delta e garante que existe um flush agendado. */
  push: (delta: PartDelta) => void;
  /** Esvazia agora (síncrono) e cancela o flush agendado. */
  flushNow: () => void;
  /** Cancela o agendamento pendente e descarta o buffer (unmount). */
  stop: () => void;
}

/**
 * `onFlush` recebe os deltas na ordem de chegada — a ordem importa, cada um é um
 * append. Nunca é chamado com lista vazia.
 */
export function createDeltaBuffer(
  onFlush: (deltas: PartDelta[]) => void,
  intervalMs: number = DELTA_FLUSH_MS,
): DeltaBuffer {
  let pending: PartDelta[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancel = (): void => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  const drain = (): void => {
    cancel();
    if (pending.length === 0) return;
    const batch = pending;
    pending = []; // troca a referência ANTES do callback: um push de dentro dele não se perde
    onFlush(batch);
  };

  return {
    push(delta: PartDelta): void {
      pending.push(delta);
      if (timer !== null) return;
      timer = setTimeout(drain, intervalMs);
      // Timer pendente não deve segurar o processo vivo no fim da sessão.
      timer.unref?.();
    },
    flushNow: drain,
    stop(): void {
      cancel();
      pending = [];
    },
  };
}
