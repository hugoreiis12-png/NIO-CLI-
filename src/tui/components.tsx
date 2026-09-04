/**
 * Peças visuais da interface NIO (Ink). O histórico vai num `<Static>` (escreve
 * no scrollback, não re-renderiza); só a mensagem em andamento + o input ficam na
 * área dinâmica, com altura limitada pra nunca estourar o terminal.
 */
import React from 'react';
import { Box, Text, useInput } from 'ink';
import { theme, sym } from './theme.js';
import { Markdown } from './markdown.js';
import { filterPalette, type PaletteItem } from './palette-source.js';
import type { ChatMessage, ChatPart } from './state.js';

export type PaletteAction = 'info' | 'run' | 'prompt';

const stripControl = (s: string): string =>
  Array.from(s).filter((ch) => ch >= ' ' && ch !== '').join('');
const splitOnEnter = (s: string): string[] => s.split(/\r|\n/);

const KIND_LABEL: Record<PaletteItem['kind'], string> = {
  command: 'cmd',
  capability: 'agente',
  help: 'ajuda',
};

export function Header({ url }: { url: string }): React.ReactElement {
  return (
    <Box justifyContent="space-between" paddingX={1}>
      <Text bold color={theme.accentBright}>{'▞ N I O'}</Text>
      <Text color={theme.dim}>opencode/big-pickle · {url.replace(/^https?:\/\//, '')}</Text>
    </Box>
  );
}

/** Descrição em verde — o token visual da sidebar. */
function Desc({ children }: { children: React.ReactNode }): React.ReactElement {
  return <Text color={theme.accent}>{children}</Text>;
}

export const Sidebar = React.memo(function Sidebar({
  session,
  sessions,
}: {
  session: { name: string; profile: string; id: string } | null;
  sessions: { id: string; title: string }[];
}): React.ReactElement {
  return (
    <Box flexDirection="column" width={26} flexShrink={0} borderStyle="round" borderColor={theme.border} paddingX={1}>
      <Text bold>Sessão</Text>
      {session ? (
        <>
          <Text wrap="truncate-end">{session.name}</Text>
          <Desc>{session.profile} · {session.id.slice(0, 8)}</Desc>
        </>
      ) : (
        <Desc>nenhuma vinculada</Desc>
      )}

      {sessions.length > 1 && (
        <>
          <Box marginTop={1}><Text bold>Outras sessões</Text></Box>
          {sessions.slice(0, 3).map((s) => (
            <Text key={s.id} color={theme.dim} wrap="truncate-end">{sym.bullet} {s.title || s.id.slice(0, 8)}</Text>
          ))}
        </>
      )}

      <Box marginTop={1}><Text bold>Atalhos</Text></Box>
      <Text><Text color={theme.accentBright}>/</Text> <Desc>paleta</Desc></Text>
      <Text><Text color={theme.accentBright}>Esc</Text> <Desc>abortar</Desc></Text>
      <Text><Text color={theme.accentBright}>^C</Text> <Desc>sair</Desc></Text>
    </Box>
  );
});

function ToolLine({ part }: { part: ChatPart }): React.ReactElement {
  const running = part.tool?.status === 'running' || part.tool?.status === 'pending';
  const color = running ? theme.warn : part.tool?.status === 'error' ? theme.err : theme.dim;
  return (
    <Text wrap="truncate-end">
      <Text color={theme.accent}>{sym.chevron} </Text>
      <Text color={theme.text}>{part.text}</Text>{' '}
      <Text color={color}>{part.tool?.status ?? ''}</Text>
    </Text>
  );
}

function Author({ role }: { role: ChatMessage['role'] }): React.ReactElement {
  return (
    <Text bold color={role === 'user' ? theme.user : theme.accentBright}>
      {role === 'user' ? `${sym.chevron} você` : `${sym.dot} nio`}
    </Text>
  );
}

function Part({ part }: { part: ChatPart }): React.ReactElement | null {
  if (part.kind === 'tool') return <ToolLine part={part} />;
  if (part.kind === 'reasoning') {
    const t = part.text.replace(/\s+/g, ' ').trim();
    return t ? <Text color={theme.dim} wrap="truncate-end">{'  '}{sym.bullet} {t}</Text> : null;
  }
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
    </Box>
  );
}

/** A mensagem em andamento — altura limitada a `maxLines` (nunca estoura a tela). */
export function LiveMessage({
  message,
  maxLines,
}: {
  message: ChatMessage;
  maxLines: number;
}): React.ReactElement {
  const text = message.parts.filter((p) => p.kind === 'text').map((p) => p.text).join('');
  const reasoning = message.parts
    .filter((p) => p.kind === 'reasoning')
    .map((p) => p.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const tools = message.parts.filter((p) => p.kind === 'tool');
  const lines = text.split('\n');
  const shown = lines.slice(-Math.max(2, maxLines));
  const clipped = lines.length > shown.length;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Author role={message.role} />
      {reasoning && (
        <Text color={theme.dim} wrap="truncate-end">{'  '}{sym.bullet} {reasoning.slice(-160)}</Text>
      )}
      {tools.map((t) => (
        <ToolLine key={t.id} part={t} />
      ))}
      {clipped && <Text color={theme.dim}>  … (rolagem acima)</Text>}
      {shown.map((l, i) => (
        <Text key={i} wrap="truncate-end">{l || ' '}</Text>
      ))}
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
        ↑↓ · Enter {cur?.kind === 'capability' ? 'manda pro agente' : 'abre info'}
        {cur?.kind === 'command' ? ' · Ctrl-R roda' : ''} · Esc sai
      </Text>
    </Box>
  );
}

/**
 * Input do chat. `/` no início liga o modo paleta **inline** — a lista fica embaixo,
 * o `/` fica visível, e apagar o `/` sai do modo (sem overlay, sem lista duplicada).
 */
export function InputBox({
  disabled,
  palette,
  onSubmit,
  onDispatch,
  defaultValue = '',
}: {
  disabled: boolean;
  palette: PaletteItem[];
  onSubmit: (text: string) => void;
  onDispatch: (item: PaletteItem, action: PaletteAction) => void;
  /** seam de teste (o render interativo não usa). */
  defaultValue?: string;
}): React.ReactElement {
  const valueRef = React.useRef(defaultValue);
  const [value, setValue] = React.useState(defaultValue);
  const [sel, setSel] = React.useState(0);
  const set = (fn: (v: string) => string) => {
    valueRef.current = fn(valueRef.current);
    setValue(valueRef.current);
  };

  const inPalette = value.startsWith('/');
  const matches = React.useMemo(
    () => (inPalette ? filterPalette(palette, value.slice(1)).slice(0, 8) : []),
    [inPalette, value, palette],
  );
  const selC = Math.min(sel, Math.max(0, matches.length - 1));

  const submit = () => {
    if (disabled) return; // deixa o texto pronto; envia quando desbloquear
    const v = valueRef.current.trim();
    set(() => '');
    setSel(0);
    if (v) onSubmit(v);
  };
  const dispatch = (action: PaletteAction) => {
    const it = matches[selC];
    if (!it) return;
    set(() => '');
    setSel(0);
    onDispatch(it, action);
  };

  useInput(
    (input, key) => {
      if (key.ctrl && input === 'r') {
        if (inPalette && matches[selC]?.kind === 'command') dispatch('run');
        return;
      }
      if (key.ctrl || key.meta || key.tab || key.leftArrow || key.rightArrow) return;
      if (key.escape) {
        if (inPalette) {
          set(() => '');
          setSel(0);
        }
        return; // fora da paleta, o Esc é do App (abortar)
      }
      if (key.upArrow) return setSel((n) => Math.max(0, n - 1));
      if (key.downArrow) {
        if (inPalette) setSel((n) => Math.min(matches.length - 1, n + 1));
        return;
      }
      if (key.return) {
        if (inPalette) return dispatch(matches[selC]?.kind === 'capability' ? 'prompt' : 'info');
        return submit();
      }
      if (key.backspace || key.delete) {
        setSel(0);
        return set((v) => v.slice(0, -1));
      }
      const [head, ...rest] = splitOnEnter(input);
      const clean = stripControl(head ?? '');
      if (clean) {
        setSel(0);
        set((v) => v + clean);
      }
      if (rest.length > 0 && !inPalette) submit();
    },
    { isActive: true },
  );

  return (
    <Box flexDirection="column">
      <Box
        borderStyle="round"
        borderColor={disabled ? theme.dim : inPalette ? theme.accentBright : theme.accent}
        paddingX={1}
      >
        <Text wrap="truncate-start">
          <Text color={disabled ? theme.dim : theme.accent}>{sym.chevron} </Text>
          {value}
          <Text color={theme.dim}>▌</Text>
          {disabled && !value && <Text color={theme.dim}>(pode digitar; envia quando a resposta terminar)</Text>}
        </Text>
      </Box>
      {inPalette && <SlashList items={matches} sel={selC} />}
    </Box>
  );
}
