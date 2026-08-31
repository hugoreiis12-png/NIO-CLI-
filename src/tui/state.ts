/**
 * Modelo de estado da conversa + normalização dos eventos do `opencode serve`.
 * As formas exatas dos `Event` do SDK podem variar entre versões do opencode —
 * aqui a leitura é defensiva (optional chaining) e `NIO_DEBUG=1` loga o evento cru.
 */
import type { Event } from '@opencode-ai/sdk';
import { dlog } from '../lib/debug.js';

export interface ChatPart {
  id: string;
  kind: 'text' | 'tool';
  /** texto (kind text) ou nome da tool (kind tool). */
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
  /** pedido de permissão pendente. */
  permission: { id: string; sessionId: string; title: string } | null;
}

export const emptyChat: ChatState = { messages: [], busy: false, permission: null };

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
  return part;
}

/** Aplica um evento ao estado (mutação de uma cópia rasa — o caller cria a cópia). */
export function applyEvent(prev: ChatState, evt: Event): ChatState {
  const state: ChatState = {
    messages: prev.messages.map((m) => ({ ...m, parts: m.parts.map((p) => ({ ...p })) })),
    busy: prev.busy,
    permission: prev.permission,
  };
  const p = (evt as { properties?: Record<string, unknown> }).properties ?? {};
  dlog('tui event:', evt.type, JSON.stringify(p).slice(0, 200));

  switch (evt.type) {
    case 'message.updated': {
      const info = (p.info ?? p) as { id?: string; role?: string };
      if (info.id) upsertMessage(state, info.id, info.role === 'user' ? 'user' : 'assistant');
      break;
    }
    case 'message.part.updated': {
      const part = (p.part ?? p) as {
        id?: string;
        messageID?: string;
        type?: string;
        text?: string;
        tool?: string;
        state?: { status?: string; output?: string; title?: string };
      };
      if (!part.messageID || !part.id) break;
      const msg = upsertMessage(state, part.messageID, 'assistant');
      if (part.type === 'tool') {
        const cp = upsertPart(msg, part.id, 'tool');
        cp.text = part.tool ?? cp.text;
        cp.tool = { status: part.state?.status ?? 'running', output: part.state?.output ?? '' };
      } else if (typeof part.text === 'string') {
        const cp = upsertPart(msg, part.id, 'text');
        cp.text = part.text;
      }
      break;
    }
    case 'permission.updated': {
      const perm = (p.permission ?? p) as { id?: string; sessionID?: string; title?: string; metadata?: { title?: string } };
      if (perm.id && perm.sessionID) {
        state.permission = { id: perm.id, sessionId: perm.sessionID, title: perm.title ?? perm.metadata?.title ?? 'permissão' };
      }
      break;
    }
    case 'permission.replied':
      state.permission = null;
      break;
    case 'session.idle':
      state.busy = false;
      break;
    case 'session.error':
      state.busy = false;
      break;
    default:
      break;
  }
  return state;
}

/** Adiciona a mensagem do usuário localmente (eco imediato) e marca busy. */
export function pushUserMessage(prev: ChatState, text: string): ChatState {
  return {
    messages: [
      ...prev.messages,
      { id: `local-${Date.now()}`, role: 'user', parts: [{ id: 'p0', kind: 'text', text }] },
    ],
    busy: true,
    permission: prev.permission,
  };
}
