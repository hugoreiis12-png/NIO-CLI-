/**
 * Extrai o que um turno produziu, a partir das mensagens do chat. Puro — o
 * `App` não precisa saber a forma interna de `ChatMessage` pra registrar a
 * trilha, e isto fica testável sem Ink.
 */
import type { ToolCallTrace } from '../core/tasks.js';
import { messageUsage, type ChatMessage } from './state.js';

export interface TurnSummary {
  text: string;
  toolCalls: ToolCallTrace[];
  tokensIn: number;
  tokensOut: number;
}

/**
 * Resume a ÚLTIMA resposta do assistant. Mensagem de compactação é pulada: ela
 * é resumo interno do motor, não resposta ao usuário — gravá-la como saída do
 * turno poria texto ofuscado na trilha.
 */
export function summarizeTurn(messages: readonly ChatMessage[]): TurnSummary {
  const vazio: TurnSummary = { text: '', toolCalls: [], tokensIn: 0, tokensOut: 0 };
  const ultima = [...messages]
    .reverse()
    .find((m) => m.role === 'assistant' && m.mode !== 'compaction' && !m.summary);
  if (!ultima) return vazio;

  const uso = messageUsage(ultima);
  return {
    text: ultima.parts
      .filter((p) => p.kind === 'text')
      .map((p) => p.text)
      .join('')
      .trim(),
    toolCalls: ultima.parts
      .filter((p) => p.kind === 'tool' && p.tool)
      .map((p) => ({ tool: p.tool!.name, status: p.tool!.status })),
    tokensIn: uso?.tokensIn ?? 0,
    tokensOut: uso?.tokensOut ?? 0,
  };
}
