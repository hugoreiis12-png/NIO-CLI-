/**
 * Peças visuais da interface NIO (Ink). O histórico vai num `<Static>` (escreve
 * no scrollback, não re-renderiza); só a mensagem em andamento + o input ficam na
 * área dinâmica, com altura limitada pra nunca estourar o terminal.
 */
import React from 'react';
import { Box, Text } from 'ink';
import { theme, sym } from './theme.js';
import { Markdown } from './markdown.js';
import { PromptInput } from './prompt-input.js';
import { filterPalette, type PaletteItem } from './palette-source.js';
import {
  messageUsage,
  summarizeToolInput,
  type ChatMessage,
  type ChatPart,
  type ChatState,
  type Toast,
  type TodoItem,
} from './state.js';

export type PaletteAction = 'info' | 'run' | 'prompt';

const KIND_LABEL: Record<PaletteItem['kind'], string> = {
  command: 'cmd',
  capability: 'agente',
  help: 'ajuda',
};

const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const kfmt = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

const TOAST_STYLE: Record<Toast['variant'], { color: string; icon: string }> = {
  info: { color: theme.dim, icon: sym.bullet },
  success: { color: theme.accent, icon: sym.ok },
  warning: { color: theme.warn, icon: sym.warn },
  error: { color: theme.err, icon: sym.err },
};

/** Resumo do diff da volta (`session.diff`, Sprint 7.8). */
export function DiffSummary({
  changes,
}: {
  changes: ChatState['diff'];
}): React.ReactElement | null {
  if (changes.length === 0) return null;
  const parts = changes.slice(0, 4).map((c) => {
    const name = c.file.split('/').pop() || c.file;
    const a = c.added ? `+${c.added}` : '';
    const r = c.removed ? `−${c.removed}` : '';
    return `${name} ${[a, r].filter(Boolean).join(' ')}`.trim();
  });
  const more = changes.length - parts.length;
  return (
    <Box paddingX={1}>
      <Text color={theme.accent} wrap="truncate-end">
        {'✎ '}
        {changes.length} arquivo(s): <Text color={theme.dim}>{parts.join(' · ')}{more > 0 ? ` · +${more}` : ''}</Text>
      </Text>
    </Box>
  );
}

/** Menu de opções da pergunta do modelo (`questionOptions`, Sprint 7.6). */
export function QuestionPicker({
  options,
  sel,
}: {
  options: string[];
  sel: number;
}): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accentBright} paddingX={1}>
      {options.map((o, i) => (
        <Text key={i} inverse={i === sel} color={i === sel ? theme.accentBright : undefined} wrap="truncate-end">
          {' '}
          {i + 1}. {o}
        </Text>
      ))}
      <Text color={theme.dim}>↑↓ escolher · ↵ responder · ou digite a sua</Text>
    </Box>
  );
}

/** Erro do motor (`session.error`, Sprint 7.3) — bloco vermelho, não bloqueia o input. */
export function ErrorBlock({
  error,
}: {
  error: NonNullable<ChatState['error']>;
}): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.err} paddingX={1}>
      <Text color={theme.err}>
        {sym.err} {error.name}
      </Text>
      <Text wrap="truncate-end">
        {'  '}
        {error.message}
      </Text>
      {error.retryable && (
        <Text color={theme.dim}>{'  reenvie o prompt pra tentar de novo'}</Text>
      )}
    </Box>
  );
}

/** Toasts do motor (`tui.toast.show`, Sprint 7.2) — linhas efêmeras acima do input. */
export function Toasts({ toasts }: { toasts: Toast[] }): React.ReactElement | null {
  if (toasts.length === 0) return null;
  return (
    <Box flexDirection="column" paddingX={1}>
      {toasts.map((t) => {
        const s = TOAST_STYLE[t.variant];
        return (
          <Text key={t.id} color={s.color} wrap="truncate-end">
            {s.icon} {t.message}
          </Text>
        );
      })}
    </Box>
  );
}

/**
 * Rodapé de 1–2 linhas — substitui a sidebar (Sprint 4, layout tipo Claude Code).
 * Linha 1: modelo · pasta · sessão · [modo] · tokens da sessão.
 * Linha 2: atalhos.
 */
export function Footer({
  model,
  cwd,
  session,
  mode,
  sessionTokens = 0,
}: {
  model: string;
  cwd: string;
  session: { name: string; profile: string } | null;
  mode?: string;
  sessionTokens?: number;
}): React.ReactElement {
  const folder = cwd.replace(/\/+$/, '').split('/').pop() || cwd;
  const bits: string[] = [`⏵ ${model}`, folder];
  if (session) bits.push(`${session.name} · ${session.profile}`);
  if (sessionTokens > 0) bits.push(`${kfmt(sessionTokens)} tok`);
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text wrap="truncate-end">
        <Text color={theme.dim}>{bits.join('  ·  ')}</Text>
        {mode ? <Text color={theme.accentBright}>{`  [${mode}]`}</Text> : null}
      </Text>
      <Text color={theme.dim}>
        <Text color={theme.accent}>/</Text> paleta{'   '}
        <Text color={theme.accent}>^R</Text> raciocínio{'   '}
        <Text color={theme.accent}>Tab</Text> modo{'   '}
        <Text color={theme.accent}>Esc</Text> abortar{'   '}
        <Text color={theme.accent}>^C</Text> sair
      </Text>
    </Box>
  );
}

/** Tool em árvore: `● nome(arg) status` + `⎿ 1ª linha da saída` (Sprint 2). */
function ToolBlock({ part }: { part: ChatPart }): React.ReactElement {
  const t = part.tool;
  const running = t?.status === 'running' || t?.status === 'pending';
  const badge = running ? theme.warn : t?.status === 'error' ? theme.err : theme.dim;
  const arg = clip(summarizeToolInput(t?.input), 48);
  const outLine = (t?.output ?? '').split('\n').find((l) => l.trim()) ?? '';
  return (
    <Box flexDirection="column">
      <Text wrap="truncate-end">
        <Text color={theme.accent}>{sym.dot} </Text>
        <Text color={theme.text}>{t?.name ?? part.text}</Text>
        {arg ? <Text color={theme.dim}>({arg})</Text> : null}{' '}
        <Text color={badge}>{t?.status ?? ''}</Text>
      </Text>
      {outLine && !running && (
        <Text color={theme.dim} wrap="truncate-end">
          {'  ⎿ '}
          {clip(outLine, 66)}
        </Text>
      )}
    </Box>
  );
}

const TODO_MARK: Record<string, string> = {
  completed: '☑',
  in_progress: '◐',
  cancelled: '⊘',
  pending: '☐',
};

/** Checklist do modelo (`todo.updated`) — o "caminho" que ele está seguindo. */
function TodoList({ todos }: { todos: TodoItem[] }): React.ReactElement | null {
  if (todos.length === 0) return null;
  return (
    <Box flexDirection="column">
      {todos.slice(0, 8).map((t, i) => (
        <Text
          key={i}
          wrap="truncate-end"
          color={
            t.status === 'completed'
              ? theme.dim
              : t.status === 'in_progress'
                ? theme.warn
                : t.status === 'cancelled'
                  ? theme.dim
                  : theme.text
          }
        >
          {'  '}
          {TODO_MARK[t.status] ?? '☐'} {t.content}
        </Text>
      ))}
    </Box>
  );
}

/** Rodapé compacto: tokens · custo · arquivos editados. */
function UsageFooter({
  usage,
  files = 0,
}: {
  usage: { tokensIn: number; tokensOut: number; cost: number } | null;
  files?: number;
}): React.ReactElement | null {
  const bits: string[] = [];
  if (usage && (usage.tokensIn || usage.tokensOut)) bits.push(`↑${kfmt(usage.tokensIn)} ↓${kfmt(usage.tokensOut)}`);
  if (usage && usage.cost > 0) bits.push(`$${usage.cost.toFixed(3)}`);
  if (files > 0) bits.push(`${files} arquivo(s)`);
  if (bits.length === 0) return null;
  return (
    <Text color={theme.dim} wrap="truncate-end">
      {'  '}
      {bits.join(' · ')}
    </Text>
  );
}

function Author({ role }: { role: ChatMessage['role'] }): React.ReactElement {
  // marcadores tipo Claude Code: `> você` / `⏺ nio` (Sprint 4)
  return (
    <Text bold color={role === 'user' ? theme.user : theme.accentBright}>
      {role === 'user' ? '> você' : '⏺ nio'}
    </Text>
  );
}

/** Raciocínio no histórico — colapsado: cabeçalho + as 2 primeiras linhas (Sprint 3). */
function ReasoningSummary({ text }: { text: string }): React.ReactElement | null {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  return (
    <Box flexDirection="column">
      <Text color={theme.dim}>
        {'  ✻ raciocínio'}
        {lines.length > 2 ? ` · ${lines.length} linhas` : ''}
      </Text>
      {lines.slice(0, 2).map((l, i) => (
        <Text key={i} color={theme.dim} wrap="truncate-end">
          {'    '}
          {l}
        </Text>
      ))}
    </Box>
  );
}

function Part({ part }: { part: ChatPart }): React.ReactElement | null {
  if (part.kind === 'step') return null; // agregado no rodapé (UsageFooter)
  if (part.kind === 'tool') return <ToolBlock part={part} />;
  if (part.kind === 'reasoning') return <ReasoningSummary text={part.text} />;
  return part.text.trim() ? <Markdown text={part.text} /> : null;
}

/** Uma mensagem completa — vai pro `<Static>`. */
export function MessageView({ message }: { message: ChatMessage }): React.ReactElement {
  return (
    <Box flexDirection="column" marginBottom={1} paddingX={1}>
      <Author role={message.role} />
      {message.parts.map((p) => (
        <Part key={p.id} part={p} />
      ))}
      {message.role === 'assistant' && <UsageFooter usage={messageUsage(message)} />}
    </Box>
  );
}

/**
 * A mensagem em andamento — reflete o motor: checklist de tarefas, tentativa em
 * curso, tools (com args + saída), raciocínio, texto e o rodapé de tokens/custo.
 * Altura do bloco de texto limitada a `maxLines` (nunca estoura a tela).
 */
export function LiveMessage({
  message,
  maxLines,
  todos = [],
  files = [],
  retry = null,
  expandReasoning = false,
}: {
  message: ChatMessage;
  maxLines: number;
  todos?: TodoItem[];
  files?: string[];
  retry?: ChatState['retry'];
  /** Sprint 3: `true` = mostra o raciocínio inteiro (toggle Ctrl-R no App). */
  expandReasoning?: boolean;
}): React.ReactElement {
  const text = message.parts.filter((p) => p.kind === 'text').map((p) => p.text).join('');
  const reasoningRaw = message.parts
    .filter((p) => p.kind === 'reasoning')
    .map((p) => p.text)
    .join('\n')
    .trim();
  const reasoningFlat = reasoningRaw.replace(/\s+/g, ' ');
  const reasoningLines = reasoningRaw.split('\n').filter((l) => l.trim());
  const allTools = message.parts.filter((p) => p.kind === 'tool');
  const tools = allTools.slice(-4); // só as últimas na área viva; o histórico tem todas
  const toolsHidden = allTools.length - tools.length;
  // orça a altura: chrome (todo + tools + rodapé + raciocínio) sai do budget de texto
  const reasoningShown =
    expandReasoning && reasoningLines.length
      ? reasoningLines.slice(-Math.min(10, Math.max(3, maxLines - 6)))
      : [];
  const chrome =
    Math.min(6, todos.length) + tools.length * 2 + (retry ? 1 : 0) + reasoningShown.length + 2;
  const textBudget = Math.max(2, maxLines - chrome);
  const lines = text.split('\n');
  const shown = lines.slice(-textBudget);
  const clipped = lines.length > shown.length;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Author role={message.role} />
      {retry && (
        <Text color={theme.warn} wrap="truncate-end">
          {'  ↻ tentativa '}
          {retry.attempt}
          {' — '}
          {retry.note}
        </Text>
      )}
      <TodoList todos={todos} />
      {toolsHidden > 0 && (
        <Text color={theme.dim}>{`  · +${toolsHidden} ferramenta(s) acima`}</Text>
      )}
      {tools.map((t) => (
        <ToolBlock key={t.id} part={t} />
      ))}
      {reasoningRaw && !expandReasoning && (
        <Text color={theme.dim} wrap="truncate-end">
          {'  ✻ raciocínio '}
          <Text color={theme.accent}>Ctrl-R</Text>
          {'  '}
          {reasoningFlat.slice(-120)}
        </Text>
      )}
      {reasoningRaw && expandReasoning && (
        <Box flexDirection="column">
          <Text color={theme.accent}>
            {'  ✻ raciocínio'}
            {reasoningLines.length > reasoningShown.length ? ` · ${reasoningLines.length} linhas` : ''}
          </Text>
          {reasoningShown.map((l, i) => (
            <Text key={i} color={theme.dim} wrap="truncate-end">
              {'    '}
              {l}
            </Text>
          ))}
        </Box>
      )}
      {clipped && <Text color={theme.dim}>  … (rolagem acima)</Text>}
      {shown.map((l, i) => (
        <Text key={i} wrap="truncate-end">{l || ' '}</Text>
      ))}
      <UsageFooter usage={messageUsage(message)} files={files.length} />
    </Box>
  );
}

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Reflete o processamento do opencode: spinner + **fase atual** (pensando /
 * raciocinando / executando ferramenta / escrevendo) + **tempo decorrido** — pra que
 * o gap silencioso do 1º token (o modelo pode levar ~20s) não pareça travamento.
 */
export function StatusLine({
  busy,
  frame,
  seconds = 0,
  label = 'processando',
}: {
  busy: boolean;
  frame: number;
  seconds?: number;
  label?: string;
}): React.ReactElement | null {
  if (!busy) return null;
  return (
    <Box paddingX={1}>
      <Text color={theme.warn}>
        {FRAMES[frame % FRAMES.length]} {label}…{' '}
        <Text color={theme.dim}>{seconds}s · Esc aborta</Text>
      </Text>
    </Box>
  );
}

function SlashList({ items, sel }: { items: PaletteItem[]; sel: number }): React.ReactElement {
  const cur = items[sel];
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
      {items.length === 0 && <Text color={theme.dim}>nenhum comando casa</Text>}
      {items.map((it, n) => (
        <Text
          key={`${it.kind}:${it.name}`}
          inverse={n === sel}
          color={n === sel ? theme.accentBright : undefined}
          wrap="truncate-end"
        >
          {' '}
          <Text color={theme.dim}>[{KIND_LABEL[it.kind]}]</Text> {it.name}  <Text color={theme.dim}>{it.desc}</Text>
        </Text>
      ))}
      <Text color={theme.dim}>
        ↑↓ · Enter{' '}
        {cur?.kind === 'capability' ? 'manda pro agente' : cur?.kind === 'command' ? 'roda' : 'abre'} ·
        Esc sai
      </Text>
    </Box>
  );
}

/** Ação default da paleta por tipo de item (Sprint 6: comando = RODAR). */
export function defaultPaletteAction(kind: PaletteItem['kind']): PaletteAction {
  return kind === 'capability' ? 'prompt' : kind === 'command' ? 'run' : 'info';
}

/**
 * Input do chat. `/` no início liga o modo paleta **inline** — a lista fica
 * embaixo, o `/` fica visível, e apagar o `/` sai do modo. A edição de texto
 * (cursor, multi-linha, atalhos, paste) vive no `<PromptInput>` (Sprint 1).
 *
 * **Controlado** (Sprint 6): `value`/`onChange` vêm do App, então o rascunho
 * sobrevive a abrir/fechar overlay. `active=false` = um overlay está por cima,
 * o input mostra o rascunho mas não captura teclado.
 */
export function InputBox({
  value,
  onChange,
  disabled,
  active = true,
  palette,
  onSubmit,
  onDispatch,
  onCycleMode,
  options = [],
  width = 80,
  maxItems = 6,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  active?: boolean;
  palette: PaletteItem[];
  onSubmit: (text: string) => void;
  onDispatch: (item: PaletteItem, action: PaletteAction) => void;
  /** Sprint 5: Tab cicla o modo do agente (o App resolve o próximo). */
  onCycleMode?: (reverse: boolean) => void;
  /** Sprint 7.6: opções da pergunta do modelo — vira um menu quando o input está vazio. */
  options?: string[];
  /** colunas disponíveis pro texto (o App calcula descontando sidebar/borda). */
  width?: number;
  /** teto de itens na droplist — o App encolhe quando a tela é curta. */
  maxItems?: number;
}): React.ReactElement {
  const [sel, setSel] = React.useState(0);
  const [optSel, setOptSel] = React.useState(0);

  const inPalette = value.startsWith('/');
  const picking = active && options.length > 0 && value === '' && !inPalette;
  const optSelC = Math.min(optSel, Math.max(0, options.length - 1));
  const optsKey = options.join('|');
  React.useEffect(() => {
    setOptSel(0);
  }, [optsKey]);
  const matches = React.useMemo(
    () => (inPalette ? filterPalette(palette, value.slice(1)).slice(0, Math.max(1, maxItems)) : []),
    [inPalette, value, palette, maxItems],
  );
  const selC = Math.min(sel, Math.max(0, matches.length - 1));

  const handleSubmit = (v: string): void => {
    const t = v.trim();
    onChange('');
    setSel(0);
    if (t) onSubmit(t);
  };
  const handleNav = (dir: 'up' | 'down' | 'submit' | 'cancel'): void => {
    if (picking) {
      if (dir === 'up') return setOptSel((n) => Math.max(0, n - 1));
      if (dir === 'down') return setOptSel((n) => Math.min(options.length - 1, n + 1));
      if (dir === 'cancel') return; // Esc no menu — deixa quieto, dá pra digitar
      const chosen = options[optSelC];
      if (chosen) {
        setOptSel(0);
        onSubmit(chosen);
      }
      return;
    }
    if (dir === 'up') return setSel((n) => Math.max(0, n - 1));
    if (dir === 'down') return setSel((n) => Math.min(matches.length - 1, n + 1));
    if (dir === 'cancel') {
      onChange('');
      return setSel(0);
    }
    const it = matches[selC];
    if (!it) return;
    onChange('');
    setSel(0);
    onDispatch(it, defaultPaletteAction(it.kind));
  };
  const handleChange = (v: string): void => {
    onChange(v);
    if (v.startsWith('/')) setSel(0);
  };

  return (
    <Box flexDirection="column">
      {picking && <QuestionPicker options={options} sel={optSelC} />}
      <PromptInput
        value={value}
        onChange={handleChange}
        onSubmit={handleSubmit}
        navCapture={(inPalette || picking) && active}
        onNav={handleNav}
        onTab={onCycleMode}
        disabled={disabled}
        active={active}
        width={width}
        placeholder={
          disabled
            ? '(pode digitar; envia quando a resposta terminar)'
            : picking
              ? '↑↓ pra escolher, ou digite'
              : ''
        }
        borderColor={disabled ? theme.dim : inPalette || picking ? theme.accentBright : theme.accent}
      />
      {inPalette && active && <SlashList items={matches} sel={selC} />}
    </Box>
  );
}
