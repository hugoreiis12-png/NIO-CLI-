/**
 * Tema da interface NIO (Ink). Verde é o accent — em especial as descrições da
 * barra lateral (pedido do dono). Reusa os símbolos de `src/lib/colors.ts`.
 */
import { sym } from '../lib/colors.js';

export const theme = {
  accent: 'green',
  accentBright: 'greenBright',
  dim: 'gray',
  text: 'white',
  warn: 'yellow',
  err: 'red',
  user: 'cyan',
  border: 'gray',
} as const;

export { sym };

/** Título compacto do NIO pro header da TUI (o splash usa o logo Matrix cheio). */
export const NIO_WORDMARK = 'N I O';
