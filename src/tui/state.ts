/**
 * Modelo de estado da conversa + normalização dos eventos do `opencode serve`.
 * Formas confirmadas com o SDK 1.18.25 (`NIO_DEBUG=1` loga o evento cru).
 */
import type { Event } from '@opencode-ai/sdk';
import { dlog } from '../lib/debug.js';

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
  const part = raw as {
    id?: string; messageID?: string; type?: string; text?: string; tool?: string;
    state?: { status?: string; output?: string; error?: string; title?: string };
  };
  if (!part.messageID || !part.id) return;
  const type = part.type ?? 'text';
  if (type === 'step-start' || type === 'step-finish') return; // ruído interno
  reconcilePending(state, part.messageID);
  const msg = upsertMessage(state, part.messageID, 'assistant');
  if (type === 'tool') {
    const cp = upsertPart(msg, part.id, 'tool');
    cp.text = part.state?.title ?? part.tool ?? 'tool';
    cp.tool = {
      status: part.state?.status ?? 'running',
      output: String(part.state?.output ?? part.state?.error ?? ''),
    };
  } else if (typeof part.text === 'string') {
    upsertPart(msg, part.id, type === 'reasoning' ? 'reasoning' : 'text').text = part.text;
  }
}

/** Aplica um evento ao estado (o caller passa o `prev`; devolve uma cópia nova). */
export function applyEvent(prev: ChatState, evt: Event): ChatState {
  const state = clone(prev);
  const p = (evt as { properties?: Record<string, unknown> }).properties ?? {};
  dlog('tui event:', evt.type, JSON.stringify(p).slice(0, 160));

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
    case 'permission.updated': {
      const perm = p as { id?: string; sessionID?: string; title?: string };
      if (perm.id && perm.sessionID) {
        state.permission = { id: perm.id, sessionId: perm.sessionID, title: perm.title ?? 'permissão' };
      }
      break;
    }
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
