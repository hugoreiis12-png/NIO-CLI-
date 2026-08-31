/**
 * Raiz da interface NIO (Ink). Splash → cria/pega a sessão do opencode → loop de
 * eventos (chat streamado) + paleta `/` + modal de permissão. O motor é o
 * `opencode serve` (big-pickle via Headroom); esta é só a casca.
 */
import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import type { Command } from 'commander';
import { renderMatrixLogo } from '../matrix-logo.js';
import { dlog } from '../lib/debug.js';
import { theme } from './theme.js';
import { Header, Sidebar, MessageList, InputBar } from './components.js';
import { Palette, InfoPanel, CommandRunner, PermissionModal } from './palette.js';
import type { PaletteItem } from './palette-source.js';
import { applyEvent, pushUserMessage, emptyChat, type ChatState } from './state.js';
import { subscribeEvents, type OpencodeHandle } from './opencode.js';

type Overlay =
  | { kind: 'none' }
  | { kind: 'palette' }
  | { kind: 'info'; item: PaletteItem }
  | { kind: 'run'; item: Extract<PaletteItem, { kind: 'command' }> };

interface AppProps {
  handle: OpencodeHandle;
  program: Command;
  cwd: string;
  session: { name: string; profile: string; id: string } | null;
  /** duração do splash em ms (seam de teste). */
  splashMs?: number;
}

export function App({ handle, program, cwd, session, splashMs = 1200 }: AppProps): React.ReactElement {
  const { stdout } = useStdout();
  const [chat, setChat] = useState<ChatState>(emptyChat);
  const [overlay, setOverlay] = useState<Overlay>({ kind: 'none' });
  const [sessions, setSessions] = useState<{ id: string; title: string }[]>([]);
  const [ready, setReady] = useState(false);
  const sessionId = useRef<string>('');
  const abortRef = useRef(new AbortController());

  // splash → depois monta a conversa
  const [splash, setSplash] = useState(splashMs > 0);
  useEffect(() => {
    if (splashMs <= 0) return;
    const t = setTimeout(() => setSplash(false), splashMs);
    return () => clearTimeout(t);
  }, [splashMs]);

  // sessão + stream de eventos
  useEffect(() => {
    if (splash) return;
    let alive = true;
    (async () => {
      try {
        const created = await handle.client.session.create({ body: { title: cwd.split('/').pop() ?? 'nio' } });
        sessionId.current = (created as { data?: { id?: string } }).data?.id ?? '';
        const list = await handle.client.session.list();
        setSessions(((list as { data?: { id: string; title?: string }[] }).data ?? []).map((s) => ({ id: s.id, title: s.title ?? '' })));
        setReady(true);
      } catch (err) {
        dlog('tui: falha ao criar sessão', (err as Error).message);
        setReady(true);
      }
      for await (const evt of subscribeEvents(handle.client, abortRef.current.signal)) {
        if (!alive) break;
        setChat((prev) => applyEvent(prev, evt));
      }
    })();
    return () => { alive = false; abortRef.current.abort(); };
  }, [splash, handle, cwd]);

  // Esc aborta a resposta em andamento (Ink já trata Ctrl-C → unmount).
  useInput((_i, key) => {
    if (key.escape && chat.busy && sessionId.current) {
      handle.client.session.abort({ path: { id: sessionId.current } }).catch(() => {});
      setChat((prev) => ({ ...prev, busy: false }));
    }
  });

  useEffect(() => () => handle.close(), [handle]);

  const send = (text: string) => {
    if (!sessionId.current) return;
    setChat((prev) => pushUserMessage(prev, text));
    handle.client.session
      .prompt({ path: { id: sessionId.current }, body: { parts: [{ type: 'text', text }] } })
      .catch((err) => dlog('tui: prompt falhou', (err as Error).message));
  };

  const respondPermission = (r: 'once' | 'always' | 'reject') => {
    const perm = chat.permission;
    if (!perm) return;
    handle.client
      .postSessionIdPermissionsPermissionId({ path: { id: perm.sessionId, permissionID: perm.id }, body: { response: r } })
      .catch(() => {});
    setChat((prev) => ({ ...prev, permission: null }));
  };

  if (splash) {
    const w = Math.min(70, (stdout?.columns ?? 70));
    return (
      <Box flexDirection="column" alignItems="center" paddingY={1}>
        <Text>{renderMatrixLogo({ width: w, height: 16 })}</Text>
        <Text color={theme.accent}>operador NIO · opencode/big-pickle</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Header url={handle.url} />
      <Box>
        <Sidebar session={session} sessions={sessions} />
        <Box flexDirection="column" flexGrow={1}>
          <MessageList messages={chat.messages} />
          {chat.permission ? (
            <PermissionModal title={chat.permission.title} onRespond={respondPermission} />
          ) : overlay.kind === 'palette' ? (
            <Palette
              program={program}
              onClose={() => setOverlay({ kind: 'none' })}
              onInfo={(item) => setOverlay({ kind: 'info', item })}
              onRun={(item) => setOverlay({ kind: 'run', item })}
              onPrompt={(prompt) => send(prompt)}
            />
          ) : overlay.kind === 'info' ? (
            <InfoPanel item={overlay.item} onClose={() => setOverlay({ kind: 'none' })} />
          ) : overlay.kind === 'run' ? (
            <CommandRunner item={overlay.item} cwd={cwd} onClose={() => setOverlay({ kind: 'none' })} />
          ) : (
            <InputBar
              busy={chat.busy || !ready}
              onSubmit={send}
              onSlash={() => setOverlay({ kind: 'palette' })}
            />
          )}
        </Box>
      </Box>
    </Box>
  );
}
