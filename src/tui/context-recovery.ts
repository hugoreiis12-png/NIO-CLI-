/**
 * Recuperação de estouro de janela de contexto.
 *
 * O que matava a sessão: ao estourar, a saída do OpenCode é o `summarize`, que
 * **reenvia o histórico inteiro** pro modelo resumir — o mesmo histórico que já não
 * cabe. Ele falha pelo mesmo motivo, e toda request seguinte repete, então só sair e
 * entrar de novo resolvia.
 *
 * A saída aqui é não depender do modelo: o resumo é montado **localmente** a partir do
 * que a TUI já tem em memória, com tamanho limitado por construção. Zera a janela
 * (sessão nova) preservando o fio da conversa.
 */
import type { ChatMessage } from './state.js';

/** Teto do resumo. Pequeno de propósito: ele vai no prompt inicial da sessão nova. */
export const HANDOFF_MAX_CHARS = 4000;
/** Quantos turnos recentes entram. O começo da conversa é o que menos importa agora. */
const HANDOFF_TURNS = 12;
/** Teto por turno, pra um único retorno de tool gigante não comer o resumo todo. */
const TURN_MAX_CHARS = 400;

/**
 * O erro é de estouro de contexto? O motor às vezes entrega o nome
 * (`ContextOverflowError`), às vezes só um `APIError` com a mensagem do provider —
 * por isso os dois caminhos.
 */
export function isContextOverflow(name: string, message = ''): boolean {
  if (name === 'ContextOverflowError') return true;
  return /maximum context length|context length exceeded|reduce the length|too many tokens/i.test(
    message,
  );
}

const clamp = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max)}…` : text;

/** Texto aproveitável de um turno: fala do usuário/assistente e nome das tools usadas. */
function turnDigest(message: ChatMessage): string | null {
  const falas = message.parts
    .filter((p) => p.kind === 'text' && p.text.trim())
    .map((p) => p.text.trim());
  const tools = message.parts
    .filter((p) => p.kind === 'tool' && p.tool?.name)
    .map((p) => p.tool!.name);

  const corpo = falas.join(' ');
  if (!corpo && tools.length === 0) return null;

  const quem = message.role === 'user' ? 'Você' : 'Eu';
  const usou = tools.length > 0 ? ` [tools: ${[...new Set(tools)].join(', ')}]` : '';
  return clamp(`${quem}: ${corpo}${usou}`, TURN_MAX_CHARS);
}

/**
 * Monta o resumo de handoff a partir dos turnos recentes. Puro e determinístico —
 * não chama o modelo, então não pode estourar nem falhar.
 *
 * Descarta as mensagens-resumo do próprio OpenCode (`summary`): resumir um resumo
 * ofuscado só degrada o que sobrou.
 */
export function buildHandoffDigest(
  messages: readonly ChatMessage[],
  maxChars = HANDOFF_MAX_CHARS,
): string {
  const uteis = messages.filter((m) => !m.summary && m.mode !== 'compaction');
  const linhas: string[] = [];
  let total = 0;

  // De trás pra frente: o fim da conversa é o que o próximo turno precisa.
  for (const m of [...uteis].reverse().slice(0, HANDOFF_TURNS)) {
    const linha = turnDigest(m);
    if (!linha) continue;
    if (total + linha.length > maxChars) break;
    linhas.unshift(linha);
    total += linha.length;
  }

  if (linhas.length === 0) return '';
  return [
    'Contexto da sessão anterior (a janela estourou e foi zerada).',
    'Resumo dos últimos turnos, do mais antigo ao mais recente:',
    '',
    ...linhas,
    '',
    'Continue daqui. Se faltar algum detalhe, pergunte em vez de supor.',
  ].join('\n');
}