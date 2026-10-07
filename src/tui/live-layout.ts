/**
 * Orçamento de altura da área viva. Mora fora do `components.tsx` porque dois
 * consumidores precisam do mesmo número: o `LiveMessage`, que corta o texto no
 * teto, e o `App`, que decide se o personagem cabe ao lado sem roubar linha do
 * conteúdo.
 *
 * Regra de prioridade: **conteúdo antes de enfeite**. O personagem é o que cede.
 */
import type { ChatMessage } from './state.js';

/** Ferramentas mostradas na área viva — o histórico no `<Static>` guarda todas. */
export const LIVE_TOOLS_SHOWN = 4;

/** Linhas que uma ferramenta ocupa no bloco vivo (cabeçalho + resumo dos args). */
const TOOL_LINES = 2;

/**
 * Altura que a mensagem viva quer ocupar: autor + texto + ferramentas visíveis.
 * É limite **inferior** de propósito — todo/retry/raciocínio só aumentam. Quem usa
 * isto pra ceder espaço erra pro lado de devolver a tela ao conteúdo.
 */
export function liveMessageLines(message: ChatMessage): number {
  let text = 0;
  let tools = 0;
  for (const part of message.parts) {
    if (part.kind === 'text') text += part.text.split('\n').length;
    else if (part.kind === 'tool') tools += 1;
  }
  return 1 + text + Math.min(tools, LIVE_TOOLS_SHOWN) * TOOL_LINES;
}

/**
 * Sobra espaço pro personagem sem apertar o conteúdo? `wanted` é a altura desejada
 * da mensagem viva, `cap` o teto da área viva e `iconRows` a altura do personagem.
 * Monotônico dentro de um turno: o texto só cresce, então ele sai de cena uma vez
 * e não fica piscando.
 */
export function roomForAvatar(wanted: number, cap: number, iconRows: number): boolean {
  return wanted <= cap - iconRows;
}
