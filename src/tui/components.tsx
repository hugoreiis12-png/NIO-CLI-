/**
 * Peças visuais da interface NIO (Ink). Sidebar com **descrições em verde**
 * (pedido do dono), lista de mensagens com cards de tool-call, e a barra de input.
 */
import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { theme, sym, NIO_WORDMARK } from './theme.js';
import { Markdown } from './markdown.js';
import type { ChatMessage, ChatPart } from './state.js';

export function Header({ url }: { url: string }): React.ReactElement {
  return (
    <Box justifyContent="space-between" paddingX={1}>
      <Text bold color={theme.accentBright}>{NIO_WORDMARK}</Text>
      <Text color={theme.dim}>opencode/big-pickle · {url.replace('http://', '')}</Text>
    </Box>
  );
}

/** Descrição em verde — o token visual pedido pra sidebar. */
function Desc({ children }: { children: React.ReactNode }): React.ReactElement {
  return <Text color={theme.accent}>{children}</Text>;
}

export function Sidebar({
  session,
  sessions,
}: {
  session: { name: string; profile: string; id: string } | null;
  sessions: { id: string; title: string }[];
}): React.ReactElement {
  return (
    <Box flexDirection="column" width={30} borderStyle="round" borderColor={theme.border} paddingX={1}>
      <Text bold>Sessão</Text>
      {session ? (
        <>
          <Text>{session.name}</Text>
          <Desc>{session.profile} · {session.id.slice(0, 8)}</Desc>
        </>
      ) : (
        <Desc>nenhuma vinculada</Desc>
      )}

      <Box marginTop={1}><Text bold>Sessões</Text></Box>
      {sessions.length === 0 && <Desc>—</Desc>}
      {sessions.slice(0, 6).map((s) => (
        <Text key={s.id} color={theme.dim}>{sym.bullet} {s.title || s.id.slice(0, 8)}</Text>
      ))}

      <Box marginTop={1}><Text bold>Atalhos</Text></Box>
      <Text><Text color={theme.accentBright}>/</Text> <Desc>paleta de comandos</Desc></Text>
      <Text><Text color={theme.accentBright}>Esc</Text> <Desc>abortar resposta</Desc></Text>
      <Text><Text color={theme.accentBright}>Ctrl-C</Text> <Desc>sair</Desc></Text>
    </Box>
  );
}

function ToolCard({ part }: { part: ChatPart }): React.ReactElement {
  const running = part.tool?.status === 'running' || part.tool?.status === 'pending';
  return (
    <Box flexDirection="column" marginY={0}>
      <Text>
        <Text color={theme.accent}>{sym.chevron} {part.text}</Text>{' '}
        <Text color={running ? theme.warn : theme.dim}>{part.tool?.status ?? ''}</Text>
      </Text>
      {part.tool?.output ? (
        <Box paddingLeft={2}>
          <Text color={theme.dim}>{part.tool.output.split('\n').slice(0, 6).join('\n')}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

export function MessageList({ messages }: { messages: ChatMessage[] }): React.ReactElement {
  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {messages.length === 0 && (
        <Text color={theme.dim}>Converse com o operador. Digite <Text color={theme.accentBright}>/</Text> para a paleta.</Text>
      )}
      {messages.map((m) => (
        <Box key={m.id} flexDirection="column" marginBottom={1}>
          <Text bold color={m.role === 'user' ? theme.user : theme.accentBright}>
            {m.role === 'user' ? 'você' : 'nio'}
          </Text>
          {m.parts.map((p) =>
            p.kind === 'tool' ? (
              <ToolCard key={p.id} part={p} />
            ) : (
              <Markdown key={p.id} text={p.text} />
            ),
          )}
        </Box>
      ))}
    </Box>
  );
}

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function InputBar({
  busy,
  onSubmit,
  onSlash,
}: {
  busy: boolean;
  onSubmit: (text: string) => void;
  onSlash: () => void;
}): React.ReactElement {
  const [value, setValue] = useState('');
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), 80);
    return () => clearInterval(t);
  }, [busy]);

  useInput((input, key) => {
    if (busy) return;
    if (key.return) {
      const v = value.trim();
      setValue('');
      if (v) onSubmit(v);
      return;
    }
    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      return;
    }
    if (input === '/' && value === '') {
      onSlash();
      return;
    }
    if (input && !key.ctrl && !key.meta) setValue((v) => v + input);
  });

  return (
    <Box borderStyle="round" borderColor={busy ? theme.warn : theme.accent} paddingX={1}>
      {busy ? (
        <Text color={theme.warn}>{FRAMES[frame]} pensando…  <Text color={theme.dim}>(Esc aborta)</Text></Text>
      ) : (
        <Text>
          <Text color={theme.accent}>{sym.chevron} </Text>
          {value}
          <Text color={theme.dim}>█</Text>
        </Text>
      )}
    </Box>
  );
}
