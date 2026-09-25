/**
 * Livro-caixa de tokens da sessão. Puro: sem IO, sem modelo.
 *
 * O que existia antes só sabia o passado: `contextUsage` lê o `tokensIn` que o provider
 * reportou na ÚLTIMA resposta. Isso é exato, mas chega tarde — enquanto um turno está
 * em voo, o número está velho e ninguém sabe quanto já foi enviado.
 *
 * Aqui o saldo tem três partes:
 * - **processado**: o que o provider contou de verdade (fonte da verdade quando existe);
 * - **pendente**: o que já saiu e ainda não voltou (estimativa, marcada como tal);
 * - **desde o resumo**: o que entrou depois da última compactação — é o que decide se
 *   compactar de novo, porque o total histórico já não está mais no contexto.
 *
 * O cursor do resumo importa: sem ele, somar o histórico inteiro faria o orçamento
 * parecer estourado logo após uma compactação bem-sucedida.
 */
import type { ChatMessage } from './state.js';

/** Aproximação de tokens por caractere. Grosseira de propósito — só vale pro pendente. */
const CHARS_POR_TOKEN = 4;

export interface TokenLedger {
  /** Tokens de entrada medidos pelo provider na última resposta. */
  processedIn: number;
  /** Saída acumulada desde o último resumo. */
  processedOut: number;
  /** Estimativa do que foi enviado e ainda não teve resposta. `0` = nada em voo. */
  pending: number;
  /** Índice da última mensagem que é resumo/compactação. `-1` = nenhuma. */
  summaryAt: number;
  /** Quantas mensagens vieram depois do resumo. */
  messagesSinceSummary: number;
}

const ehResumo = (m: ChatMessage): boolean => m.summary === true || m.mode === 'compaction';

/** Índice da última compactação — o ponto a partir do qual o contexto real começa. */
export function summaryCursor(messages: readonly ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (ehResumo(messages[i]!)) return i;
  }
  return -1;
}

/** Estimativa de tokens de um texto ainda não processado. */
export function estimateTokens(texto: string): number {
  return Math.ceil(texto.length / CHARS_POR_TOKEN);
}

/**
 * Monta o saldo. `inFlightChars` é o tamanho do prompt que acabou de sair (0 quando
 * não há nada em voo) — é ele que transforma "não sei" em "pendente".
 */
export function buildLedger(messages: readonly ChatMessage[], inFlightChars = 0): TokenLedger {
  const cursor = summaryCursor(messages);
  const depois = messages.slice(cursor + 1);

  let processedIn = 0;
  let processedOut = 0;
  for (const m of depois) {
    if (m.role !== 'assistant') continue;
    for (const p of m.parts) {
      if (!p.step) continue;
      // `tokensIn` é o tamanho do prompt daquela chamada, não um incremento: o maior
      // é o estado mais recente do contexto. Somar daria número sem significado.
      processedIn = Math.max(processedIn, p.step.tokensIn);
      processedOut += p.step.tokensOut;
    }
  }

  return {
    processedIn,
    processedOut,
    pending: inFlightChars > 0 ? Math.ceil(inFlightChars / CHARS_POR_TOKEN) : 0,
    summaryAt: cursor,
    messagesSinceSummary: depois.length,
  };
}

/** Total a considerar contra a janela: o medido mais o que ainda vai ser processado. */
export function ledgerTotal(l: TokenLedger): number {
  return l.processedIn + l.processedOut + l.pending;
}

/**
 * Há trabalho em voo? Enquanto houver, nada pode abortar a sessão — é a regra que
 * impede a request de morrer no meio.
 */
export function hasWorkInFlight(l: TokenLedger): boolean {
  return l.pending > 0;
}

/** Linha curta pro rodapé/diagnóstico. */
export function describeLedger(l: TokenLedger): string {
  const partes = [`↑${l.processedIn}`, `↓${l.processedOut}`];
  if (l.pending > 0) partes.push(`~${l.pending} em voo`);
  if (l.summaryAt >= 0) partes.push(`desde o resumo: ${l.messagesSinceSummary} msg`);
  return partes.join(' · ');
}
