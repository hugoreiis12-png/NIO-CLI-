/**
 * Leitura do stream SSE do `opencode serve` — puro, sem cliente nem IO, para a
 * parte arriscada ser testável sem subir processo.
 *
 * O que está aqui foi aprendido em produção pela TUI (`src/tui/state.ts`), não
 * derivado dos tipos do SDK. Três armadilhas que custaram caro lá e que um
 * executor headless paga mais caro ainda (ninguém vê o travamento):
 *
 * 1. O motor emite `permission.asked`, mas os tipos do SDK só listam
 *    `permission.updated`. Tratar um só deixa o turno preso para sempre.
 * 2. A tool `question` bloqueia igual a uma permissão, e aparece em duas
 *    famílias (`question.*` e `question.v2.*`) — o motor escolhe qual emitir.
 * 3. Os eventos **não vêm filtrados por sessão**. Sem recortar pelo `sessionID`,
 *    a saída de outra sessão entra no step errado.
 *
 * Uma quarta, achada depois (2026-09-30): `session.error` cobre tanto estouro de
 * janela de contexto quanto resposta cortada pelo teto de saída — dois problemas
 * com recuperação BEM diferente (sessão nova vs. pedir continuação), que o
 * executor precisa distinguir, não só detectar que "deu erro".
 */
import type { ToolCallTrace } from '../../core/tasks.js';
import { isContextOverflow } from '../../core/agent.js';

/** Shape do part como o motor manda (o SDK não tipa os campos que usamos). */
interface RawPart {
  id?: string;
  sessionID?: string;
  type?: string;
  text?: string;
  tool?: string;
  state?: { status?: string; output?: string; error?: string };
  tokens?: { input?: number; output?: number };
}

interface EventoBruto {
  type?: string;
  properties?: Record<string, unknown>;
}

function props(evt: unknown): Record<string, unknown> {
  return (evt as EventoBruto).properties ?? {};
}

function tipo(evt: unknown): string {
  return String((evt as EventoBruto).type ?? '');
}

/** `sessionID` do evento, olhando os lugares onde o motor o coloca. */
export function eventSessionId(evt: unknown): string | undefined {
  const p = props(evt);
  const direto = p.sessionID;
  if (typeof direto === 'string') return direto;
  for (const chave of ['part', 'info']) {
    const filho = p[chave] as { sessionID?: unknown } | undefined;
    if (filho && typeof filho.sessionID === 'string') return filho.sessionID;
  }
  return undefined;
}

/** Fim do turno: o motor sinaliza de duas formas e emite as duas. */
export function isTurnEnd(evt: unknown): boolean {
  const t = tipo(evt);
  if (t === 'session.idle') return true;
  if (t !== 'session.status') return false;
  const status = props(evt).status as { type?: string } | undefined;
  return status?.type === 'idle';
}

export interface PedidoBloqueante {
  id: string;
  sessionId: string;
  /** Nome da tool (permissão) ou rótulo da pergunta. */
  subject: string;
}

/** Normaliza `permission.asked` **e** `permission.updated` — o motor usa o primeiro. */
export function permissionFrom(evt: unknown): PedidoBloqueante | null {
  const t = tipo(evt);
  if (t !== 'permission.asked' && t !== 'permission.updated') return null;
  const p = props(evt) as {
    id?: string;
    sessionID?: string;
    permission?: string;
    type?: string;
    tool?: { name?: string };
  };
  if (!p.id || !p.sessionID) return null;
  return {
    id: p.id,
    sessionId: p.sessionID,
    subject: p.tool?.name ?? p.permission ?? p.type ?? 'ação',
  };
}

/** Normaliza `question.asked` e a família paralela `question.v2.asked`. */
export function questionFrom(evt: unknown): PedidoBloqueante | null {
  const bruto = tipo(evt);
  const t = bruto.startsWith('question.v2.') ? bruto.replace('.v2.', '.') : bruto;
  if (t !== 'question.asked' && t !== 'question.updated') return null;
  const p = props(evt) as { id?: string; sessionID?: string; title?: string; question?: string };
  if (!p.id || !p.sessionID) return null;
  return { id: p.id, sessionId: p.sessionID, subject: p.title ?? p.question ?? 'pergunta' };
}

/**
 * `context_overflow` e `output_length` têm recuperação automática (sessão nova
 * com resumo; pedido de continuação). `other` é o resto — erro genuíno do
 * motor, sem recuperação conhecida, falha o step com o texto real do provider.
 */
export type EngineErrorKind = 'context_overflow' | 'output_length' | 'other';

export interface EngineError {
  kind: EngineErrorKind;
  name: string;
  message: string;
}

/**
 * Normaliza `session.error`. Mesma heurística de `isContextOverflow` que a TUI
 * usa — o motor às vezes nomeia o erro, às vezes só devolve a mensagem crua do
 * provider por trás de um `APIError` genérico.
 */
export function engineErrorFrom(evt: unknown): EngineError | null {
  if (tipo(evt) !== 'session.error') return null;
  const p = props(evt) as { error?: { name?: string; data?: { message?: string } } };
  const err = p.error;
  if (!err) return null;
  // Abort deliberado (nosso próprio `session.abort`, ou Esc na TUI) não é falha do motor.
  if (err.name === 'MessageAbortedError') return null;

  const nome = err.name ?? '';
  const mensagem = typeof err.data?.message === 'string' ? err.data.message : '';
  const kind: EngineErrorKind = isContextOverflow(nome, mensagem)
    ? 'context_overflow'
    : nome === 'MessageOutputLengthError'
      ? 'output_length'
      : 'other';
  return { kind, name: nome || 'EngineError', message: mensagem || nome || 'erro no motor' };
}

export interface StepAccumulated {
  text: string;
  toolCalls: ToolCallTrace[];
  tokensIn: number;
  tokensOut: number;
}

/**
 * Junta o que o step produziu. `message.part.updated` traz **snapshot**, não
 * delta — por isso cada part é indexado por id e sobrescrito, nunca concatenado.
 * (`message.part.delta` é ruído e é descartado pelo chamador.)
 */
export function createStepAccumulator(): {
  apply(evt: unknown): void;
  result(): StepAccumulated;
} {
  const textos = new Map<string, string>();
  const tools = new Map<string, ToolCallTrace>();
  let tokensIn = 0;
  let tokensOut = 0;

  const aplicarPart = (raw: RawPart): void => {
    if (!raw.id) return;
    if (raw.type === 'text' && typeof raw.text === 'string') {
      textos.set(raw.id, raw.text);
      return;
    }
    if (raw.type === 'tool' && raw.tool) {
      tools.set(raw.id, { tool: raw.tool, status: raw.state?.status ?? 'unknown' });
      return;
    }
    // `step-finish` é onde o motor fecha a conta de tokens do passo agêntico.
    if (raw.tokens) {
      tokensIn += raw.tokens.input ?? 0;
      tokensOut += raw.tokens.output ?? 0;
    }
  };

  return {
    apply(evt: unknown): void {
      if (tipo(evt) !== 'message.part.updated') return;
      const p = props(evt);
      aplicarPart((p.part ?? p) as RawPart);
    },
    result(): StepAccumulated {
      return {
        text: [...textos.values()].join('').trim(),
        toolCalls: [...tools.values()],
        tokensIn,
        tokensOut,
      };
    },
  };
}
