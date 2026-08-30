import { spinner as clackSpinner } from '@clack/prompts';

/**
 * Spinner de progresso, agora sobre o `@clack/prompts` (mesma linguagem visual dos
 * prompts). Mantém a MESMA API de antes, então nenhum call-site muda:
 *  - `succeed(msg)` → linha de sucesso (✓);
 *  - `fail(msg)`    → linha de erro (✗ vermelho);
 *  - `stop()`       → limpa silenciosamente (comportamento histórico); `stop(msg)` fecha com sucesso.
 */
export interface Spinner {
  succeed: (message?: string) => void;
  fail: (message?: string) => void;
  stop: (message?: string) => void;
  message: (message: string) => void;
}

export function startSpinner(message: string): Spinner {
  const s = clackSpinner();
  s.start(message);
  return {
    succeed: (msg) => s.stop(msg ?? message),
    fail: (msg) => s.error(msg ?? message),
    stop: (msg) => (msg ? s.stop(msg) : s.clear()),
    message: (msg) => s.message(msg),
  };
}
