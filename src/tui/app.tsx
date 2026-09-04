/**
 * Raiz da interface NIO (Ink). Histórico → `<Static>` (scrollback, não re-renderiza);
 * área dinâmica = mensagem em andamento (altura limitada) + input. Evita o estouro
 * de altura que corrompe o Ink.
 */
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Box, Text, Static, useInput, useStdout } from 'ink';
import type { Command } from 'commander';
import { renderMatrixLogo } from '../matrix-logo.js';
import { tlog } from './debug.js';
import { theme } from './theme.js';
import { Header, Sidebar, MessageView, LiveMessage, StatusLine, InputBox, type PaletteAction } from './components.js';
import { InfoPanel, CommandRunner, PermissionModal } from './palette.js';
import { buildPalette, type PaletteItem } from './palette-source.js';
import { applyEvent, pushUserMessage, syncMessages, emptyChat, type ChatState } from './state.js';
import { subscribeEvents, type OpencodeHandle } from './opencode.js';

type Overlay =
  | { kind: 'none' }
  | { kind: 'info'; item: PaletteItem }
  | { kind: 'run'; item: Extract<PaletteItem, { kind: 'command' }> };

interface AppProps {
  handle: OpencodeHandle;
  program: Command;
  cwd: string;
  session: { name: string; profile: string; id: string } | null;
  splashMs?: number;
  /** força um modelo (só testes/probe; prod usa o default do opencode.json = big-pickle). */
  model?: { providerID: string; modelID: string };
}

/** rows/columns do terminal, reativo ao resize. */
function useTerminalSize(): { rows: number; columns: number } {
  const { stdout } = useStdout();
  const [size, setSize] = useState({ rows: stdout?.rows ?? 24, columns: stdout?.columns ?? 80 });
  useEffect(() => {
    if (!stdout) return;
    const on = () => setSize({ rows: stdout.rows ?? 24, columns: stdout.columns ?? 80 });
    stdout.on('resize', on);
    return () => {
      stdout.off('resize', on);
    };
  }, [stdout]);
  return size;
}

export function App({ handle, program, cwd, session, splashMs = 1200, model }: AppProps): React.ReactElement {
  const { rows, columns } = useTerminalSize();
  const [chat, setChat] = useState<ChatState>(emptyChat);
  const [overlay, setOverlay] = useState<Overlay>({ kind: 'none' });
  const [sessions, setSessions] = useState<{ id: string; title: string }[]>([]);
  const [ready, setReady] = useState(false);
  const [frame, setFrame] = useState(0);
  const sessionId = useRef<string>('');
  const abortRef = useRef(new AbortController());
  const busyStartedAt = useRef<number>(0); // pro tempo decorrido no StatusLine

  const [splash, setSplash] = useState(splashMs > 0);
  useEffect(() => {
    if (splashMs <= 0) return;
    const t = setTimeout(() => setSplash(false), splashMs);
    return () => clearTimeout(t);
  }, [splashMs]);

  // spinner — marca o início do processamento (pro tempo decorrido) e tica o frame
  useEffect(() => {
    if (!chat.busy) return;
    busyStartedAt.current = Date.now();
    const t = setInterval(() => setFrame((f) => f + 1), 90);
    return () => clearInterval(t);
  }, [chat.busy]);

  /** Re-sincroniza com o server (fonte da verdade): status + mensagens. */
  const resync = React.useCallback(async () => {
    const id = sessionId.current;
    if (!id) return;
    try {
      const [st, msgs] = await Promise.all([
        handle.client.session.status(),
        handle.client.session.messages({ path: { id } }),
      ]);
      const status = (st as { data?: Record<string, { type?: string }> }).data?.[id]?.type;
      const busy = status === 'busy' || status === 'retry';
      const raw = ((msgs as { data?: unknown[] }).data ?? []) as Parameters<typeof syncMessages>[1];
      setChat((prev) => syncMessages(prev, raw, busy));
    } catch (err) {
      tlog('resync falhou', (err as Error).message);
    }
  }, [handle]);

  // sessão + stream de eventos (reconecta pra sempre)
  useEffect(() => {
    if (splash) return;
    let alive = true;
    const ac = abortRef.current;
    (async () => {
      try {
        const created = await handle.client.session.create({ body: { title: cwd.split('/').pop() ?? 'nio' } });
        sessionId.current = (created as { data?: { id?: string } }).data?.id ?? '';
        const list = await handle.client.session.list();
        setSessions(((list as { data?: { id: string; title?: string }[] }).data ?? []).slice(0, 20).map((s) => ({ id: s.id, title: s.title ?? '' })));
      } catch (err) {
        tlog('falha ao criar sessão', (err as Error).message);
      }
      setReady(true);
      for await (const evt of subscribeEvents(handle.client, ac.signal)) {
        if (!alive) break;
        if (evt === null) {
          void resync(); // (re)conectou → re-sincroniza
          continue;
        }
        if ((evt.type as string) === 'message.part.delta') continue; // ruído: o snapshot vem em message.part.updated
        setChat((prev) => applyEvent(prev, evt));
      }
    })();
    return () => {
      alive = false;
      ac.abort();
    };
  }, [splash, handle, cwd, resync]);

  // rede de segurança: se ficar `busy` sem eventos, confere o status no server
  useEffect(() => {
    if (!chat.busy) return;
    const t = setInterval(resync, 4000);
    return () => clearInterval(t);
  }, [chat.busy, resync]);

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
      .prompt({ path: { id: sessionId.current }, body: { model, parts: [{ type: 'text', text }] } })
      .catch((err) => tlog('prompt falhou', (err as Error).message));
  };

  const palette = useMemo(() => buildPalette(program), [program]);
  const onDispatch = (item: PaletteItem, action: PaletteAction) => {
    if (action === 'prompt' && item.kind === 'capability') return send(item.prompt);
    if (action === 'run' && item.kind === 'command') return setOverlay({ kind: 'run', item });
    setOverlay({ kind: 'info', item }); // 'info' (comando/help)
  };

  const respondPermission = (r: 'once' | 'always' | 'reject') => {
    const perm = chat.permission;
    if (!perm) return;
    setChat((prev) => ({ ...prev, permission: null }));
    handle.client
      .postSessionIdPermissionsPermissionId({ path: { id: perm.sessionId, permissionID: perm.id }, body: { response: r } })
      .catch((err) => tlog('permission respond falhou', (err as Error).message))
      .finally(() => {
        void resync();
      });
  };

  // histórico (Static) vs. a última mensagem se estiver streamando
  const { finished, live } = useMemo(() => {
    const msgs = chat.messages;
    const lastIsLive = chat.busy && msgs.length > 0 && msgs[msgs.length - 1]!.role === 'assistant';
    return {
      finished: lastIsLive ? msgs.slice(0, -1) : msgs,
      live: lastIsLive ? msgs[msgs.length - 1]! : null,
    };
  }, [chat.messages, chat.busy]);

  // fase atual (reflete o que o opencode está fazendo) — mostrada no StatusLine
  const phase = useMemo(() => {
    const parts = live?.parts ?? [];
    const tool = parts.find((p) => p.kind === 'tool' && (p.tool?.status === 'running' || p.tool?.status === 'pending'));
    if (tool) return `executando ${tool.text}`;
    const hasText = parts.some((p) => p.kind === 'text' && p.text.trim());
    const hasReasoning = parts.some((p) => p.kind === 'reasoning' && p.text.trim());
    if (hasText) return 'escrevendo';
    if (hasReasoning) return 'raciocinando';
    return 'pensando';
  }, [live]);
  // tempo decorrido (o frame do spinner força o re-render ~11×/s enquanto busy)
  const elapsed = chat.busy ? Math.max(0, Math.floor((Date.now() - busyStartedAt.current) / 1000)) : 0;

  if (splash) {
    return (
      <Box flexDirection="column" alignItems="center" paddingY={1}>
        <Text>{renderMatrixLogo({ width: Math.min(70, columns), height: 16 })}</Text>
        <Text color={theme.accent}>operador NIO · opencode/big-pickle</Text>
      </Box>
    );
  }

  const liveMax = Math.max(4, Math.floor(rows * 0.4));
  const disabled = chat.busy || !ready;

  return (
    <Box flexDirection="column" width={columns}>
      <Static items={finished}>{(m) => <MessageView key={m.id} message={m} />}</Static>

      <Box flexDirection="row">
        <Sidebar session={session} sessions={sessions} />
        <Box flexDirection="column" flexGrow={1} minWidth={0}>
          <Header url={handle.url} />
          {live && <LiveMessage message={live} maxLines={liveMax} />}
          <StatusLine busy={chat.busy} frame={frame} seconds={elapsed} label={phase} />

          {chat.permission ? (
            <PermissionModal title={chat.permission.title} onRespond={respondPermission} />
          ) : overlay.kind === 'info' ? (
            <InfoPanel item={overlay.item} onClose={() => setOverlay({ kind: 'none' })} />
          ) : overlay.kind === 'run' ? (
            <CommandRunner item={overlay.item} cwd={cwd} onClose={() => setOverlay({ kind: 'none' })} />
          ) : (
            <InputBox disabled={disabled} palette={palette} onSubmit={send} onDispatch={onDispatch} />
          )}
        </Box>
      </Box>
    </Box>
  );
}
