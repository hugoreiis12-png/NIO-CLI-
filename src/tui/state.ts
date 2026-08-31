/**
 * Modelo de estado da conversa + normalização dos eventos do `opencode serve`.
 * Formas confirmadas com o SDK 1.18.25 (`NIO_DEBUG=1` loga o evento cru).
 */
import type { Event } from '@opencode-ai/sdk';
import { tlog } from './debug.js';

export interface ChatPart {
  id: string;
  kind: 'text' | 'reasoning' | 'tool';
  /** texto (text/reasoning) ou título (tool). */
  text: string;
  /** kind tool: estado + saída. */
  tool?: { status: string; output: string };
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  parts: ChatPart[];
}

export interface ChatState {
  messages: ChatMessage[];
  busy: boolean;
  permission: { id: string; sessionId: string; title: string } | null;
}

export const emptyChat: ChatState = { messages: [], busy: false, permission: null };
const PENDING_USER = 'pending-user';

function clone(prev: ChatState): ChatState {
  return {
    messages: prev.messages.map((m) => ({ ...m, parts: m.parts.map((p) => ({ ...p })) })),
    busy: prev.busy,
    permission: prev.permission,
  };
}

function upsertMessage(state: ChatState, id: string, role: ChatMessage['role']): ChatMessage {
  let msg = state.messages.find((m) => m.id === id);
  if (!msg) {
    msg = { id, role, parts: [] };
    state.messages.push(msg);
  }
  return msg;
}

function upsertPart(msg: ChatMessage, id: string, kind: ChatPart['kind']): ChatPart {
  let part = msg.parts.find((p) => p.id === id);
  if (!part) {
    part = { id, kind, text: '' };
    msg.parts.push(part);
  }
  part.kind = kind;
  return part;
}

/** Tira o eco local do usuário quando a mensagem real chega. */
function reconcilePending(state: ChatState, realId: string): void {
  if (realId === PENDING_USER) return;
  const i = state.messages.findIndex((m) => m.id === PENDING_USER);
  if (i >= 0) state.messages.splice(i, 1);
}

function applyPart(state: ChatState, raw: Record<string, unknown>): void {
  const messageID = raw.messageID as string | undefined;
  if (!messageID || !raw.id) return;
  reconcilePending(state, messageID);
  applyPartInto(upsertMessage(state, messageID, 'assistant'), raw);
}

/** Aplica um evento ao estado (o caller passa o `prev`; devolve uma cópia nova). */
export function applyEvent(prev: ChatState, evt: Event): ChatState {
  const state = clone(prev);
  const p = (evt as { properties?: Record<string, unknown> }).properties ?? {};
  tlog('event', evt.type, JSON.stringify(p).slice(0, 200));

  // `permission.asked` é o que o opencode 1.18 emite de verdade (os tipos do SDK
  // ainda listam só `permission.updated`). Ambos caem aqui.
  const etype = evt.type as string;
  if (etype === 'permission.asked' || etype === 'permission.updated') {
    const perm = p as {
      id?: string; sessionID?: string; title?: string;
      permission?: string; patterns?: string[]; tool?: { name?: string };
    };
    if (perm.id && perm.sessionID) {
      const what = perm.patterns?.length ? ` ${perm.patterns.join(', ')}` : '';
      state.permission = {
        id: perm.id,
        sessionId: perm.sessionID,
        title: perm.title ?? `${perm.permission ?? perm.tool?.name ?? 'ação'}${what}`,
      };
    }
    return state;
  }

  switch (evt.type) {
    case 'message.updated': {
      const info = (p.info ?? p) as { id?: string; role?: string };
      if (info.id) {
        reconcilePending(state, info.id);
        upsertMessage(state, info.id, info.role === 'user' ? 'user' : 'assistant');
      }
      break;
    }
    case 'message.part.updated':
      applyPart(state, (p.part ?? p) as Record<string, unknown>);
      break;
    case 'permission.replied':
      state.permission = null;
      break;
    case 'session.idle':
    case 'session.error':
      state.busy = false;
      break;
    case 'session.status':
      if ((p.status as { type?: string } | undefined)?.type === 'idle') state.busy = false;
      break;
    default:
      break;
  }
  return state;
}

/**
 * Reconstrói as mensagens a partir do `session.messages()` do server (fonte da
 * verdade). Usado no re-sync após reconexão / no poll de segurança.
 */
export function syncMessages(
  prev: ChatState,
  raw: Array<{ info?: { id?: string; role?: string }; parts?: Array<Record<string, unknown>> }>,
  busy: boolean,
): ChatState {
  const state: ChatState = { messages: [], busy, permission: prev.permission };
  for (const m of raw) {
    if (!m.info?.id) continue;
    const msg = upsertMessage(state, m.info.id, m.info.role === 'user' ? 'user' : 'assistant');
    for (const raw of m.parts ?? []) applyPartInto(msg, raw);
  }
  // se o server ainda não listou a última pergunta, preserva o eco local
  const pending = prev.messages.find((x) => x.id === PENDING_USER);
  if (pending && !state.messages.some((x) => x.role === 'user' && sameText(x, pending))) {
    state.messages.push(pending);
  }
  return state;
}

function sameText(a: ChatMessage, b: ChatMessage): boolean {
  const t = (m: ChatMessage) => m.parts.map((p) => p.text).join('').trim();
  return t(a) === t(b);
}

/** applyPart mas direto num `msg` já resolvido (usado pelo syncMessages). */
function applyPartInto(msg: ChatMessage, raw: Record<string, unknown>): void {
  const part = raw as {
    id?: string; type?: string; text?: string; tool?: string;
    state?: { status?: string; output?: string; error?: string; title?: string };
  };
  if (!part.id) return;
  const type = part.type ?? 'text';
  if (type === 'step-start' || type === 'step-finish') return;
  if (type === 'tool') {
    const cp = upsertPart(msg, part.id, 'tool');
    cp.text = part.state?.title ?? part.tool ?? 'tool';
    cp.tool = { status: part.state?.status ?? 'running', output: String(part.state?.output ?? part.state?.error ?? '') };
  } else if (typeof part.text === 'string') {
    upsertPart(msg, part.id, type === 'reasoning' ? 'reasoning' : 'text').text = part.text;
  }
}

/** Eco imediato da mensagem do usuário + marca busy. */
export function pushUserMessage(prev: ChatState, text: string): ChatState {
  return {
    messages: [
      ...prev.messages.filter((m) => m.id !== PENDING_USER),
      { id: PENDING_USER, role: 'user', parts: [{ id: 'p0', kind: 'text', text }] },
    ],
    busy: true,
    permission: prev.permission,
  };
}
