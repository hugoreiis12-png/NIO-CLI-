/**
 * Modelo de estado da conversa + normalização dos eventos do `opencode serve`.
 * Formas confirmadas com o SDK 1.18.x (`NIO_DEBUG=1` loga o evento cru).
 *
 * Sprint 2 de UI/UX: reflete o que o motor realmente faz — não só o texto final.
 * Além dos parts de texto/raciocínio/tool, guarda: a **lista de tarefas** do
 * modelo (`todo.updated`), os **arquivos editados** (`file.edited`), a
 * **tentativa em curso** (`session.status` type `retry`) e, por part,
 * **tokens/custo** (`step-finish`) e os **args + saída** de cada tool.
 */
import type { Event } from '@opencode-ai/sdk';
import { tlog } from './debug.js';

export interface ChatPart {
  id: string;
  kind: 'text' | 'reasoning' | 'tool' | 'step';
  /** texto (text/reasoning) ou título (tool). */
  text: string;
  /** kind tool: nome, estado, args de entrada e saída. */
  tool?: {
    name: string;
    status: string;
    input?: Record<string, unknown>;
    output: string;
  };
  /** kind step: uso do passo agêntico (step-finish). */
  step?: { tokensIn: number; tokensOut: number; cost: number };
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  parts: ChatPart[];
}

export interface TodoItem {
  content: string;
  /** pending | in_progress | completed | cancelled */
  status: string;
}

/**
 * Um pedido de permissão do motor (Sprint 7.1). Batch paralelo = N desses — daí
 * `ChatState.permissions` ser uma **fila** (era 1 slot só, que perdia os outros
 * N-1 e travava o opencode em `busy`).
 */
export interface PermissionReq {
  id: string;
  sessionId: string;
  /** `bash` | `edit` | `read` | … | `<mcpServer>_<tool>`. */
  kind: string;
  /** Os comandos/paths exatos (cada item do pipe, no caso do bash). */
  patterns: string[];
  /** `metadata.command` — a linha de shell completa (só bash). */
  command?: string;
  /** Os globs que "sempre" salvaria (ex.: `["find *", "sort *"]`). */
  always: string[];
  title: string;
}

/** Rótulo humano por grupo de permissão. */
export function permGroupLabel(kind: string): string {
  const g: Record<string, string> = {
    bash: 'shell',
    edit: 'editar arquivo',
    read: 'ler arquivo',
    glob: 'listar arquivos',
    grep: 'buscar no código',
    webfetch: 'baixar URL',
    websearch: 'buscar na web',
    external_directory: 'acessar fora do projeto',
    doom_loop: 'continuar (possível loop)',
    task: 'sub-agente',
    skill: 'rodar skill',
    todowrite: 'atualizar checklist',
  };
  return g[kind] ?? (kind.includes('_') ? `MCP · ${kind}` : kind);
}

/**
 * Normaliza uma permissão pendente — venha ela do evento SSE (`permission.asked`/
 * `.updated`) ou do `GET /permission` (o `resync` usa isso). O REST manda
 * `permission`/`patterns`; o SDK tipa `type`/`pattern` — aceitamos os dois.
 * `sessionID` pode ser de um **sub-agente** (`task`): guardamos como veio, sem
 * filtrar — o `respondPermission` responde nessa sessão.
 */
export function toPermissionReq(raw: Record<string, unknown>): PermissionReq | null {
  const perm = raw as {
    id?: string; sessionID?: string; title?: string;
    permission?: string; type?: string;
    patterns?: string[]; pattern?: string | string[];
    always?: string[];
    metadata?: { command?: string };
    tool?: { name?: string };
  };
  if (!perm.id || !perm.sessionID) return null;
  const kind = perm.permission ?? perm.type ?? perm.tool?.name ?? 'ação';
  const patterns =
    perm.patterns ??
    (Array.isArray(perm.pattern) ? perm.pattern : perm.pattern ? [perm.pattern] : []);
  return {
    id: perm.id,
    sessionId: perm.sessionID,
    kind,
    patterns,
    command: perm.metadata?.command,
    always: perm.always ?? [],
    title: perm.title ?? permGroupLabel(kind),
  };
}

/**
 * Reconcilia a fila de permissões com a verdade do server (`GET /permission`).
 * Sem isto, um `permission.asked` perdido (reconexão do SSE no meio, ou vindo de
 * um **sub-agente** que a TUI não estava ouvindo) trava o motor pra sempre em
 * "processando" — não há evento de repetição. Chamado no `resync` (a cada 4s
 * enquanto `busy`). Adiciona as novas (dedup por id), tira as que sumiram.
 */
export function reconcilePendingPermissions(
  prev: ChatState,
  rawList: Array<Record<string, unknown>>,
): ChatState {
  const live = rawList.map(toPermissionReq).filter((r): r is PermissionReq => r !== null);
  const liveIds = new Set(live.map((r) => r.id));
  const kept = prev.permissions.filter((r) => liveIds.has(r.id));
  const known = new Set(kept.map((r) => r.id));
  const added = live.filter((r) => !known.has(r.id));
  if (added.length === 0 && kept.length === prev.permissions.length) return prev;
  return { ...prev, permissions: [...kept, ...added] };
}

/** Toast do motor (`tui.toast.show`, Sprint 7.2) — some sozinho em `until`. */
export interface Toast {
  id: string;
  message: string;
  variant: 'info' | 'success' | 'warning' | 'error';
  /** epoch ms — o App poda quando `Date.now() > until`. */
  until: number;
}

export interface ChatState {
  messages: ChatMessage[];
  busy: boolean;
  /** Fila de pedidos de permissão — mostra `[0]`, ao responder faz shift. */
  permissions: PermissionReq[];
  /** Toasts efêmeros do motor (`tui.toast.show`). */
  toasts: Toast[];
  /** Lista de tarefas do modelo nesta volta (`todo.updated`). */
  todos: TodoItem[];
  /** Arquivos que o modelo editou nesta volta (`file.edited`, dedup). */
  files: string[];
  /** Tentativa em curso (rate-limit / erro transitório) — `session.status`. */
  retry: { attempt: number; note: string } | null;
  /** Último erro do motor (`session.error`) — some no próximo prompt. */
  error: { name: string; message: string; retryable: boolean } | null;
  /** Diff da volta (`session.diff`) — arquivos + linhas +/−. Some no próximo prompt. */
  diff: { file: string; added: number; removed: number }[];
}

/** Dica humana por tipo de erro do motor. */
function errorHint(name: string): string {
  switch (name) {
    case 'ProviderAuthError':
      return 'credencial do provedor inválida — rode `opencode auth login`';
    case 'MessageOutputLengthError':
      return 'a resposta ficou longa demais — peça em partes menores';
    case 'APIError':
      return 'erro na API do provedor';
    default:
      return 'erro no motor';
  }
}

export const emptyChat: ChatState = {
  messages: [],
  busy: false,
  permissions: [],
  toasts: [],
  todos: [],
  files: [],
  retry: null,
  error: null,
  diff: [],
};
const PENDING_USER = 'pending-user';

function clone(prev: ChatState): ChatState {
  return {
    messages: prev.messages.map((m) => ({ ...m, parts: m.parts.map((p) => ({ ...p })) })),
    busy: prev.busy,
    permissions: prev.permissions,
    toasts: prev.toasts,
    todos: prev.todos,
    files: prev.files,
    retry: prev.retry,
    error: prev.error,
    diff: prev.diff,
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
  // ainda listam só `permission.updated`). Ambos caem aqui. Batch paralelo =
  // N eventos → **empilha na fila** (Sprint 7.1), não sobrescreve.
  const etype = evt.type as string;
  if (etype === 'permission.asked' || etype === 'permission.updated') {
    const req = toPermissionReq(p);
    if (req && !state.permissions.some((x) => x.id === req.id)) {
      state.permissions = [...state.permissions, req];
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
    case 'permission.replied': {
      const id = p.permissionID as string | undefined;
      state.permissions = id ? state.permissions.filter((x) => x.id !== id) : [];
      break;
    }
    case 'todo.updated': {
      const todos = ((p.todos as Array<Record<string, unknown>>) ?? []).map((t) => ({
        content: String(t.content ?? ''),
        status: String(t.status ?? 'pending'),
      }));
      state.todos = todos;
      break;
    }
    case 'file.edited': {
      const f = p.file as string | undefined;
      if (f && !state.files.includes(f)) state.files = [...state.files, f];
      break;
    }
    case 'tui.toast.show': {
      const t = p as { title?: string; message?: string; variant?: string; duration?: number };
      const message = [t.title, t.message].filter(Boolean).join(' — ') || 'aviso';
      const variant = (['info', 'success', 'warning', 'error'].includes(t.variant ?? '')
        ? t.variant
        : 'info') as Toast['variant'];
      state.toasts = [
        ...state.toasts.slice(-4), // teto de 5
        { id: `toast-${Date.now()}-${state.toasts.length}`, message, variant, until: Date.now() + Math.max(1500, t.duration ?? 4000) },
      ];
      break;
    }
    case 'session.idle':
      state.busy = false;
      state.retry = null;
      break;
    case 'session.error': {
      state.busy = false;
      state.retry = null;
      const err = p.error as { name?: string; data?: Record<string, unknown> } | undefined;
      // `MessageAbortedError` = o usuário apertou Esc — não é erro pra mostrar.
      if (err?.name && err.name !== 'MessageAbortedError') {
        const data = err.data ?? {};
        const raw = typeof data.message === 'string' ? data.message : '';
        const hint = errorHint(err.name);
        const useHint = err.name === 'ProviderAuthError' || err.name === 'MessageOutputLengthError' || !raw;
        state.error = {
          name: err.name,
          message: useHint ? hint : raw,
          retryable: err.name === 'APIError' && Boolean(data.isRetryable),
        };
      }
      break;
    }
    case 'session.diff': {
      const files = (p.diff as Array<{ file?: string; additions?: number; deletions?: number }>) ?? [];
      state.diff = files
        .filter((d) => d.file)
        .map((d) => ({ file: String(d.file), added: d.additions ?? 0, removed: d.deletions ?? 0 }));
      break;
    }
    case 'session.compacted':
      state.toasts = [
        ...state.toasts.slice(-4),
        { id: `toast-${Date.now()}`, message: '✂ contexto compactado', variant: 'info', until: Date.now() + 4000 },
      ];
      break;
    case 'installation.update-available': {
      const v = (p as { version?: string }).version;
      state.toasts = [
        ...state.toasts.slice(-4),
        { id: `toast-${Date.now()}`, message: `nova versão do opencode: ${v ?? '?'}`, variant: 'info', until: Date.now() + 6000 },
      ];
      break;
    }
    case 'session.status': {
      const st = p.status as { type?: string; attempt?: number; message?: string } | undefined;
      if (st?.type === 'idle') {
        state.busy = false;
        state.retry = null;
      } else if (st?.type === 'busy') {
        state.busy = true;
      } else if (st?.type === 'retry') {
        state.busy = true;
        state.retry = { attempt: st.attempt ?? 1, note: st.message ?? 'tentando de novo' };
      }
      break;
    }
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
  const state: ChatState = {
    messages: [],
    busy,
    permissions: prev.permissions,
    toasts: prev.toasts,
    todos: prev.todos,
    files: prev.files,
    retry: busy ? prev.retry : null,
    error: prev.error,
    diff: prev.diff,
  };
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
    state?: { status?: string; output?: string; error?: string; title?: string; input?: Record<string, unknown> };
    tokens?: { input?: number; output?: number };
    cost?: number;
  };
  if (!part.id) return;
  const type = part.type ?? 'text';
  if (type === 'step-start') return;
  if (type === 'step-finish') {
    const cp = upsertPart(msg, part.id, 'step');
    cp.step = {
      tokensIn: part.tokens?.input ?? 0,
      tokensOut: part.tokens?.output ?? 0,
      cost: part.cost ?? 0,
    };
    return;
  }
  if (type === 'tool') {
    const cp = upsertPart(msg, part.id, 'tool');
    cp.text = part.state?.title ?? part.tool ?? 'tool';
    cp.tool = {
      name: part.tool ?? 'tool',
      status: part.state?.status ?? 'running',
      input: part.state?.input,
      output: String(part.state?.output ?? part.state?.error ?? ''),
    };
    return;
  }
  if (typeof part.text === 'string') {
    upsertPart(msg, part.id, type === 'reasoning' ? 'reasoning' : 'text').text = part.text;
  }
}

/** Eco imediato da mensagem do usuário + marca busy. Zera todos/arquivos da volta anterior. */
export function pushUserMessage(prev: ChatState, text: string): ChatState {
  return {
    messages: [
      ...prev.messages.filter((m) => m.id !== PENDING_USER),
      { id: PENDING_USER, role: 'user', parts: [{ id: 'p0', kind: 'text', text }] },
    ],
    busy: true,
    permissions: prev.permissions,
    toasts: prev.toasts,
    todos: [],
    files: [],
    retry: null,
    error: null,
    diff: [],
  };
}

// ─── seletores pra UI (puros) ───────────────────────────────────────────────

/** Resumo curto dos args de uma tool (arquivo / comando / pattern / url…). */
export function summarizeToolInput(input?: Record<string, unknown>): string {
  if (!input) return '';
  const keys = ['filePath', 'file_path', 'command', 'pattern', 'query', 'url', 'path', 'prompt', 'description'];
  for (const k of keys) if (typeof input[k] === 'string' && input[k]) return String(input[k]);
  const first = Object.values(input).find((v) => typeof v === 'string' && v);
  return first ? String(first) : '';
}

/** Soma dos tokens/custo de todos os `step` parts de uma mensagem. */
export function messageUsage(msg: ChatMessage): { tokensIn: number; tokensOut: number; cost: number } | null {
  const steps = msg.parts.filter((p): p is ChatPart & { step: NonNullable<ChatPart['step']> } => !!p.step);
  if (steps.length === 0) return null;
  return steps.reduce(
    (acc, s) => ({
      tokensIn: acc.tokensIn + s.step.tokensIn,
      tokensOut: acc.tokensOut + s.step.tokensOut,
      cost: acc.cost + s.step.cost,
    }),
    { tokensIn: 0, tokensOut: 0, cost: 0 },
  );
}

/** Texto (sem blocos de código) da última mensagem, se ela for do assistant e a
 *  conversa estiver parada e sem permissão pendente. `null` caso contrário. */
function idleAssistantText(state: ChatState): string | null {
  if (state.busy || state.permissions.length > 0) return null;
  const last = state.messages[state.messages.length - 1];
  if (!last || last.role !== 'assistant') return null;
  const text = last.parts
    .filter((p) => p.kind === 'text')
    .map((p) => p.text)
    .join('')
    .replace(/```[\s\S]*?```/g, '') // ignora blocos de código
    .trim();
  return text || null;
}

/**
 * Sprint 7.4 — o big-pickle não tem "pergunta e espera"; ele termina o texto com
 * `?` e para. Devolve a pergunta (a linha com `?`) pra a UI destacar. `null` =
 * nada aguardando.
 */
export function pendingQuestion(state: ChatState): string | null {
  const text = idleAssistantText(state);
  if (!text) return null;
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const lastLine = lines.at(-1) ?? '';
  if (/\?["'`)\]]*$/.test(lastLine)) return lastLine;
  // pergunta seguida de opções: pega a última linha que termina com `?`
  const qLine = [...lines].reverse().find((l) => /\?["'`)\]]*$/.test(l));
  return qLine ?? null;
}

/**
 * Sprint 7.6 — extrai opções numeradas/marcadas da última mensagem do assistant
 * (só quando ela contém uma pergunta). `1. …` / `2) …` / `- [ ] …` / `a) …`.
 * `[]` se < 2 opções (aí é texto normal, não menu).
 */
export function questionOptions(state: ChatState): string[] {
  const text = idleAssistantText(state);
  if (!text || !text.includes('?')) return [];
  const opts: string[] = [];
  for (const raw of text.split('\n')) {
    const m = /^\s*(?:\d{1,2}[.)]|[-*]\s*\[[ xX]?\]|[a-zA-Z][.)])\s+(.{2,120}?)\s*$/.exec(raw);
    if (m?.[1]) opts.push(m[1].trim());
  }
  return opts.length >= 2 ? opts.slice(0, 8) : [];
}
