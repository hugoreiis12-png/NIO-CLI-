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
  kind: 'text' | 'reasoning' | 'tool' | 'step' | 'fork';
  /** texto (text/reasoning) ou título (tool/fork). */
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
  /** kind fork: sub-agente disparado pelo modelo (part `subtask`). */
  fork?: { agent: string; description: string };
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  parts: ChatPart[];
  /** `message.info.mode` — `compaction` marca o resumo interno do opencode (ofuscado). */
  mode?: string;
  /** `message.info.summary` — `true` = mensagem-resumo (compactação), não é resposta real. */
  summary?: boolean;
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

/** Uma opção de uma pergunta estruturada (tool `question` do opencode). */
export interface QuestionOption {
  label: string;
  description?: string;
}

/** Uma pergunta do tool `question` (o modelo pergunta com opções). */
export interface QuestionItem {
  question: string;
  header?: string;
  /** `true` = múltipla escolha; senão single-select. */
  multi?: boolean;
  options: QuestionOption[];
}

/**
 * Pedido do tool `question` (Sprint UX). Fila paralela à de permissões — o opencode
 * fica `awaiting answer` até a TUI responder via `POST /session/:id/question/:id/reply`
 * com `{ answers }`. Sem handler, o turno trava em `running` pra sempre.
 */
export interface QuestionReq {
  /** `requestID` do evento — usado no reply/reject. */
  id: string;
  sessionId: string;
  questions: QuestionItem[];
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
  rawList: Array<Record<string, unknown>> | null,
): ChatState {
  if (rawList === null) return prev; // fetch falhou → mantém a fila (não apaga o modal)
  const live = rawList.map(toPermissionReq).filter((r): r is PermissionReq => r !== null);
  const liveIds = new Set(live.map((r) => r.id));
  const kept = prev.permissions.filter((r) => liveIds.has(r.id));
  const known = new Set(kept.map((r) => r.id));
  const added = live.filter((r) => !known.has(r.id));
  if (added.length === 0 && kept.length === prev.permissions.length) return prev;
  return { ...prev, permissions: [...kept, ...added] };
}

/**
 * Normaliza um pedido de `question` — do evento SSE (`question.asked`/`.updated`) ou
 * do `GET /session/:id/question` (resync). `requestID` é o id do reply; as perguntas
 * podem vir no topo (`questions`) ou em `input.questions`. `null` se malformado.
 */
export function toQuestionReq(raw: Record<string, unknown>): QuestionReq | null {
  const r = raw as {
    id?: string; requestID?: string; sessionID?: string;
    questions?: Array<Record<string, unknown>>;
    input?: { questions?: Array<Record<string, unknown>> };
  };
  const id = r.requestID ?? r.id;
  if (!id || !r.sessionID) return null;
  const rawQs = r.questions ?? r.input?.questions ?? [];
  const questions: QuestionItem[] = rawQs.map((q) => ({
    question: String(q.question ?? ''),
    header: q.header ? String(q.header) : undefined,
    multi: Boolean(q.multi ?? q.multiple),
    options: ((q.options as Array<Record<string, unknown>>) ?? []).map((o) => ({
      label: String(o.label ?? o.value ?? o ?? ''),
      description: o.description ? String(o.description) : undefined,
    })),
  }));
  return { id: String(id), sessionId: String(r.sessionID), questions };
}

/** Reconcilia a fila de perguntas com a verdade do server (`GET /session/:id/question`). */
export function reconcilePendingQuestions(
  prev: ChatState,
  rawList: Array<Record<string, unknown>> | null,
): ChatState {
  if (rawList === null) return prev; // fetch falhou → mantém a fila (não apaga a pergunta)
  const live = rawList.map(toQuestionReq).filter((r): r is QuestionReq => r !== null);
  const liveIds = new Set(live.map((r) => r.id));
  const kept = prev.questions.filter((r) => liveIds.has(r.id));
  const known = new Set(kept.map((r) => r.id));
  const added = live.filter((r) => !known.has(r.id));
  if (added.length === 0 && kept.length === prev.questions.length) return prev;
  return { ...prev, questions: [...kept, ...added] };
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
  /** Fila de perguntas do tool `question` — mostra `[0]`, ao responder faz shift. */
  questions: QuestionReq[];
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
  questions: [],
  toasts: [],
  todos: [],
  files: [],
  retry: null,
  error: null,
  diff: [],
};
const PENDING_USER = 'pending-user';

/** Part cru vindo do SDK (`message.part.updated` / `session.messages`). */
interface RawPart {
  id?: string;
  messageID?: string;
  type?: string;
  text?: string;
  tool?: string;
  state?: { status?: string; output?: string; error?: string; title?: string; input?: Record<string, unknown> };
  tokens?: { input?: number; output?: number };
  cost?: number;
  /** part `subtask` (fork disparado pelo modelo). */
  agent?: string;
  description?: string;
  /** metadata do part; `compaction_continue` = aviso sintético de mídia removida. */
  metadata?: { compaction_continue?: boolean };
}

/** COW: tira o eco local `pending-user` quando a mensagem real chega. `messages`
 *  intacto (mesma referência) quando não há eco a remover. */
function withoutPending(messages: ChatMessage[], realId: string): ChatMessage[] {
  if (realId === PENDING_USER) return messages;
  const i = messages.findIndex((m) => m.id === PENDING_USER);
  if (i < 0) return messages;
  return [...messages.slice(0, i), ...messages.slice(i + 1)];
}

/**
 * COW: array de mensagens com a mensagem `id` transformada (criada como `role` se
 * ausente). **Só a mensagem tocada é copiada** — as demais mantêm identidade, o que
 * evita o clone total do histórico a cada evento (era o custo O(N×M) por evento).
 */
function withMessage(
  messages: ChatMessage[],
  id: string,
  role: ChatMessage['role'],
  transform: (parts: ChatPart[]) => ChatPart[],
  meta?: { mode?: string; summary?: boolean },
): ChatMessage[] {
  const i = messages.findIndex((m) => m.id === id);
  if (i < 0) return [...messages, { id, role, parts: transform([]), ...meta }];
  const msg = messages[i]!;
  const parts = transform(msg.parts);
  const metaChanged =
    !!meta && ((meta.mode !== undefined && meta.mode !== msg.mode) || (meta.summary !== undefined && meta.summary !== msg.summary));
  if (parts === msg.parts && !metaChanged) return messages;
  const next = messages.slice();
  next[i] = { ...msg, parts, ...meta };
  return next;
}

/** Extrai `mode`/`summary` do `info` de um evento/mensagem (só chaves presentes). */
function metaFromInfo(info: { mode?: unknown; summary?: unknown }): { mode?: string; summary?: boolean } {
  const meta: { mode?: string; summary?: boolean } = {};
  if (typeof info.mode === 'string') meta.mode = info.mode;
  if (typeof info.summary === 'boolean') meta.summary = info.summary;
  return meta;
}

/** Pares de tag de reasoning inline (lista canônica, espelha o open-webui). */
const REASONING_TAGS: [string, string][] = [
  ['<think>', '</think>'],
  ['<thinking>', '</thinking>'],
  ['<reason>', '</reason>'],
  ['<reasoning>', '</reasoning>'],
  ['<thought>', '</thought>'],
  ['◁think▷', '◁/think▷'],
  ['<|begin_of_thought|>', '<|end_of_thought|>'],
];

/**
 * Fallback: tira reasoning inline do texto de saída, pra quando o provider NÃO
 * separa o reasoning num part próprio (ex.: vLLM sem `--reasoning-parser`, ou
 * outro modelo que emite `<think>` no content). Remove spans fechados; um tag
 * aberto sem fechamento (streaming) corta do tag até o fim. Puro, sem regex.
 */
export function stripReasoningTags(text: string): string {
  let out = text;
  for (const [open, close] of REASONING_TAGS) {
    let start = out.indexOf(open);
    while (start >= 0) {
      const end = out.indexOf(close, start + open.length);
      if (end < 0) {
        out = out.slice(0, start); // aberto sem fechar → some do tag em diante
        break;
      }
      out = out.slice(0, start) + out.slice(end + close.length);
      start = out.indexOf(open);
    }
  }
  return out;
}

/**
 * Interpreta um part cru do SDK sobre o part anterior (por id) e devolve o novo part
 * — ou `null` pra ignorar (`step-start`, ou texto ausente sem part prévio). Puro.
 */
function computePart(prev: ChatPart | undefined, raw: RawPart): ChatPart | null {
  const id = raw.id as string;
  const type = raw.type ?? 'text';
  // step-start não tem conteúdo; `compaction` é o resumo interno da auto-compaction
  // do opencode — nunca renderiza, senão o "pensamento de compressão" vaza no output.
  if (type === 'step-start' || type === 'compaction') return null;
  if (type === 'step-finish') {
    return {
      id, kind: 'step', text: prev?.text ?? '',
      step: { tokensIn: raw.tokens?.input ?? 0, tokensOut: raw.tokens?.output ?? 0, cost: raw.cost ?? 0 },
    };
  }
  if (type === 'tool') {
    return {
      id, kind: 'tool', text: raw.state?.title ?? raw.tool ?? 'tool',
      tool: {
        name: raw.tool ?? 'tool', status: raw.state?.status ?? 'running',
        input: raw.state?.input, output: String(raw.state?.output ?? raw.state?.error ?? ''),
      },
    };
  }
  if (type === 'subtask') {
    const agent = raw.agent ?? 'agent';
    const description = raw.description ?? '';
    return { id, kind: 'fork', text: description || agent, fork: { agent, description } };
  }
  // aviso sintético do opencode: anexo grande removido + contexto compactado. Mostra
  // um marcador conciso no lugar do parágrafo longo (senão parece que travou raciocinando).
  if (raw.metadata?.compaction_continue) {
    return { id, kind: 'text', text: '✂ anexo grande removido — contexto compactado; reenvie menor se precisar.' };
  }
  if (typeof raw.text === 'string') {
    const kind = type === 'reasoning' ? 'reasoning' : 'text';
    // no output (`text`), tira reasoning inline que o provider não separou; o part
    // `reasoning` em si (live) mantém o texto cru.
    return { id, kind, text: kind === 'text' ? stripReasoningTags(raw.text) : raw.text };
  }
  return prev ?? null;
}

/** COW: aplica um part cru a `parts` (cria/atualiza por id). `parts` intacto se ignorado. */
function applyRawPart(parts: ChatPart[], raw: RawPart): ChatPart[] {
  if (!raw.id) return parts;
  const i = parts.findIndex((p) => p.id === raw.id);
  const next = computePart(i < 0 ? undefined : parts[i]!, raw);
  if (next === null || next === parts[i]) return parts;
  if (i < 0) return [...parts, next];
  const arr = parts.slice();
  arr[i] = next;
  return arr;
}

/** Aplica um evento ao estado (o caller passa o `prev`; devolve uma cópia nova). */
export function applyEvent(prev: ChatState, evt: Event): ChatState {
  const state: ChatState = { ...prev };
  const p = (evt as { properties?: Record<string, unknown> }).properties ?? {};
  tlog('event', evt.type, p); // o cap de tamanho fica no tlog (debug.ts), não aqui

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

  // Tool `question` — mesmo padrão de fila que a permissão. Sem isto o turno trava
  // em `running` esperando a resposta que a TUI nunca enviava.
  if (etype === 'question.asked' || etype === 'question.updated') {
    const req = toQuestionReq(p);
    if (req && !state.questions.some((x) => x.id === req.id)) {
      state.questions = [...state.questions, req];
    }
    return state;
  }
  if (etype === 'question.replied' || etype === 'question.answered') {
    const id = (p.requestID ?? p.questionID) as string | undefined;
    state.questions = id ? state.questions.filter((x) => x.id !== id) : [];
    return state;
  }

  switch (evt.type) {
    case 'message.updated': {
      const info = (p.info ?? p) as { id?: string; role?: string; mode?: unknown; summary?: unknown };
      if (info.id) {
        const role = info.role === 'user' ? 'user' : 'assistant';
        state.messages = withMessage(
          withoutPending(state.messages, info.id),
          info.id,
          role,
          (parts) => parts,
          metaFromInfo(info),
        );
      }
      break;
    }
    case 'message.part.updated': {
      const raw = (p.part ?? p) as RawPart;
      if (raw.messageID && raw.id) {
        state.messages = withMessage(
          withoutPending(state.messages, raw.messageID),
          raw.messageID,
          'assistant',
          (parts) => applyRawPart(parts, raw),
        );
      }
      break;
    }
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
  raw: Array<{ info?: { id?: string; role?: string; mode?: unknown; summary?: unknown }; parts?: Array<Record<string, unknown>> }>,
  busy: boolean,
): ChatState {
  let messages: ChatMessage[] = [];
  for (const m of raw) {
    if (!m.info?.id) continue;
    const role = m.info.role === 'user' ? 'user' : 'assistant';
    const meta = metaFromInfo(m.info);
    messages = withMessage(
      messages,
      m.info.id,
      role,
      (parts) => {
        let acc = parts;
        for (const rp of m.parts ?? []) acc = applyRawPart(acc, rp as RawPart);
        return acc;
      },
      meta,
    );
  }
  // se o server ainda não listou a última pergunta, preserva o eco local
  const pending = prev.messages.find((x) => x.id === PENDING_USER);
  if (pending && !messages.some((x) => x.role === 'user' && sameText(x, pending))) {
    messages = [...messages, pending];
  }
  return { ...prev, messages, busy, retry: busy ? prev.retry : null };
}

function sameText(a: ChatMessage, b: ChatMessage): boolean {
  const t = (m: ChatMessage) => m.parts.map((p) => p.text).join('').trim();
  return t(a) === t(b);
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
    questions: prev.questions,
    toasts: prev.toasts,
    todos: [],
    files: [],
    retry: null,
    error: null,
    diff: [],
  };
}

// ─── seletores pra UI (puros) ───────────────────────────────────────────────

/**
 * Marcadores de seção do scaffolding/resumo interno (formato da compactação do
 * opencode e de "work-state/handoff"). Token = a keyword; semântica = header de seção.
 */
const SCAFFOLD_MARKERS = [
  'objective', 'important details', 'work state', 'completed',
  'active', 'blocked', 'next move', 'relevant files',
];

/** `true` se o texto casa o padrão de scaffolding (≥3 headers de seção). Puro. */
export function looksLikeScaffolding(text: string): boolean {
  if (!text) return false;
  let hits = 0;
  for (const m of SCAFFOLD_MARKERS) {
    if (new RegExp(`(^|\\n)\\s*#{0,3}\\s*${m}\\b`, 'i').test(text)) hits++;
    if (hits >= 3) return true;
  }
  return false;
}

/**
 * `true` = mensagem interna a OFUSCAR do output: resumo da compactação (flag exata
 * `mode:compaction`/`summary`) OU texto que casa o scaffolding (rede semântica).
 */
export function isInternalMessage(m: ChatMessage): boolean {
  if (m.mode === 'compaction' || m.summary === true) return true;
  const text = m.parts.filter((p) => p.kind === 'text').map((p) => p.text).join('\n');
  return looksLikeScaffolding(text);
}

/** Resumo curto dos args de uma tool (arquivo / comando / pattern / url…). */
export function summarizeToolInput(input?: Record<string, unknown>): string {
  if (!input) return '';
  const keys = ['filePath', 'file_path', 'command', 'pattern', 'query', 'url', 'path', 'prompt', 'description'];
  for (const k of keys) if (typeof input[k] === 'string' && input[k]) return String(input[k]);
  const first = Object.values(input).find((v) => typeof v === 'string' && v);
  return first ? String(first) : '';
}

/**
 * Uso da janela de contexto no último turno do assistant, pra o rodapé medir
 * "quanto o turno gastou" contra a janela do provider. `tokensIn` = o MAIOR
 * `tokensIn` entre os steps (o prompt de pico já inclui todo o histórico —
 * somar contaria o contexto N vezes); `tokensOut` = a SOMA do output gerado nos
 * steps. Em turno multi-step o total in+out superestima um pouco (o output de um
 * step vira input do próximo), o que é o lado seguro pra um medidor de teto.
 * `{0,0}` se nenhum turno reportou uso. Puro.
 */
export function contextUsage(messages: ChatMessage[]): { tokensIn: number; tokensOut: number } {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== 'assistant') continue;
    const steps = m.parts.filter((p) => p.step).map((p) => p.step!);
    if (steps.length === 0) continue;
    return {
      tokensIn: Math.max(...steps.map((s) => s.tokensIn)),
      tokensOut: steps.reduce((n, s) => n + s.tokensOut, 0),
    };
  }
  return { tokensIn: 0, tokensOut: 0 };
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
