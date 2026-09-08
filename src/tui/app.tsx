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
import {
  Footer,
  MessageView,
  LiveMessage,
  StatusLine,
  InputBox,
  Toasts,
  ErrorBlock,
  DiffSummary,
  type PaletteAction,
} from './components.js';
import { InfoPanel, CommandRunner, PermissionModal } from './palette.js';
import { buildPalette, type PaletteItem } from './palette-source.js';
import {
  applyEvent,
  messageUsage,
  pendingQuestion,
  questionOptions,
  pushUserMessage,
  syncMessages,
  reconcilePendingPermissions,
  emptyChat,
  type ChatState,
} from './state.js';
import {
  listPrimaryAgents,
  subscribeEvents,
  fetchPendingPermissions,
  type OpencodeHandle,
} from './opencode.js';

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
  const [draft, setDraft] = useState(''); // rascunho do input — no App pra sobreviver a overlays (Sprint 6)
  const [showReasoning, setShowReasoning] = useState(false); // Sprint 3: Ctrl-R expande o raciocínio
  const [modes, setModes] = useState<string[]>(['build', 'plan']); // Sprint 5: agentes primários (Tab cicla)
  const [mode, setMode] = useState('build');
  const [ready, setReady] = useState(false);
  const [frame, setFrame] = useState(0);
  const sessionId = useRef<string>('');
  const abortRef = useRef(new AbortController());
  const busyStartedAt = useRef<number>(0); // pro tempo decorrido no StatusLine
  const tuiCommandRef = useRef<(cmd: string) => void>(() => {}); // Sprint 7.2 — closures frescas

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
      const [st, msgs, perms] = await Promise.all([
        handle.client.session.status(),
        handle.client.session.messages({ path: { id } }),
        fetchPendingPermissions(handle.url),
      ]);
      const status = (st as { data?: Record<string, { type?: string }> }).data?.[id]?.type;
      const busy = status === 'busy' || status === 'retry';
      const raw = ((msgs as { data?: unknown[] }).data ?? []) as Parameters<typeof syncMessages>[1];
      setChat((prev) => reconcilePendingPermissions(syncMessages(prev, raw, busy), perms));
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
        const agents = await listPrimaryAgents(handle.client);
        setModes(agents);
        setMode((cur) => (agents.includes(cur) ? cur : agents[0] ?? 'build'));
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
        const et = evt.type as string;
        if (et === 'message.part.delta') continue; // ruído: o snapshot vem em message.part.updated
        // Sprint 7.2 — o motor dirige a TUI (imperativo, fora do ChatState):
        if (et === 'tui.prompt.append') {
          const text = (evt as { properties?: { text?: string } }).properties?.text ?? '';
          if (text) setDraft((d) => (d ? `${d} ${text}` : text));
          continue;
        }
        if (et === 'tui.command.execute') {
          const cmd = (evt as { properties?: { command?: string } }).properties?.command ?? '';
          tuiCommandRef.current(cmd);
          continue;
        }
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

  // Sprint 7.2 — poda toasts expirados (`until`).
  useEffect(() => {
    if (chat.toasts.length === 0) return;
    const iv = setInterval(() => {
      setChat((prev) => {
        const now = Date.now();
        const kept = prev.toasts.filter((x) => x.until > now);
        return kept.length === prev.toasts.length ? prev : { ...prev, toasts: kept };
      });
    }, 700);
    return () => clearInterval(iv);
  }, [chat.toasts.length]);

  // Atalhos globais — inativos quando há overlay/permissão por cima (o Esc é deles).
  useInput(
    (input, key) => {
      if (key.ctrl && input === 'r') return setShowReasoning((v) => !v); // Sprint 3
      if (key.escape && chat.busy && sessionId.current) {
        handle.client.session.abort({ path: { id: sessionId.current } }).catch(() => {});
        setChat((prev) => ({ ...prev, busy: false }));
      }
    },
    { isActive: overlay.kind === 'none' && chat.permissions.length === 0 },
  );

  useEffect(() => () => handle.close(), [handle]);

  const send = (text: string) => {
    if (!sessionId.current) return;
    setDraft('');
    setChat((prev) => pushUserMessage(prev, text));
    handle.client.session
      .prompt({ path: { id: sessionId.current }, body: { model, agent: mode, parts: [{ type: 'text', text }] } })
      .catch((err) => tlog('prompt falhou', (err as Error).message));
  };

  // Sprint 5: Tab cicla o modo do agente (build ⇄ plan ⇄ …).
  const cycleMode = (reverse: boolean) => {
    setMode((cur) => {
      const n = modes.length;
      if (n === 0) return cur;
      const i = Math.max(0, modes.indexOf(cur));
      return modes[(i + (reverse ? -1 : 1) + n) % n] ?? cur;
    });
  };

  // Sprint 7.2 — mapeia `tui.command.execute` do motor. Guardado num ref
  // (atualizado a cada render) pra o loop de eventos ver closures frescas.
  const toast = (message: string, variant: 'info' | 'warning' = 'info') =>
    setChat((prev) => ({
      ...prev,
      toasts: [
        ...prev.toasts.slice(-4),
        { id: `toast-${Date.now()}`, message, variant, until: Date.now() + 3000 },
      ],
    }));
  tuiCommandRef.current = (cmd: string) => {
    switch (cmd) {
      case 'prompt.clear':
        return setDraft('');
      case 'prompt.submit':
        return send(draft);
      case 'agent.cycle':
        return cycleMode(false);
      case 'session.interrupt':
        if (sessionId.current)
          handle.client.session.abort({ path: { id: sessionId.current } }).catch(() => {});
        return setChat((prev) => ({ ...prev, busy: false }));
      case 'session.compact':
        if (sessionId.current)
          handle.client.session.summarize({ path: { id: sessionId.current } }).catch(() => {});
        return toast('compactando o contexto…');
      default:
        return toast(`comando do motor ignorado: ${cmd}`);
    }
  };

  const palette = useMemo(() => buildPalette(program), [program]);
  const onDispatch = (item: PaletteItem, action: PaletteAction) => {
    setDraft('');
    if (action === 'prompt' && item.kind === 'capability') return send(item.prompt);
    if (action === 'run' && item.kind === 'command') return setOverlay({ kind: 'run', item });
    setOverlay({ kind: 'info', item }); // 'info' (help, ou comando sem run)
  };
  const closeOverlay = () => setOverlay({ kind: 'none' });

  // Sprint 7.1: responde o 1º da FILA e faz shift — os outros N-1 do batch
  // paralelo aparecem em sequência (antes: só 1 slot, o resto ficava órfão e
  // o opencode travava em `busy`).
  const respondPermission = (r: 'once' | 'always' | 'reject') => {
    const perm = chat.permissions[0];
    if (!perm) return;
    setChat((prev) => ({ ...prev, permissions: prev.permissions.slice(1) }));
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
    if (chat.retry) return `tentando de novo (${chat.retry.attempt})`;
    const parts = live?.parts ?? [];
    const tool = parts.find((p) => p.kind === 'tool' && (p.tool?.status === 'running' || p.tool?.status === 'pending'));
    if (tool) return `executando ${tool.tool?.name ?? tool.text}`;
    const hasText = parts.some((p) => p.kind === 'text' && p.text.trim());
    const hasReasoning = parts.some((p) => p.kind === 'reasoning' && p.text.trim());
    if (hasText) return 'escrevendo';
    if (hasReasoning) return 'raciocinando';
    return 'pensando';
  }, [live, chat.retry]);
  // tempo decorrido (o frame do spinner força o re-render ~11×/s enquanto busy)
  const elapsed = chat.busy ? Math.max(0, Math.floor((Date.now() - busyStartedAt.current) / 1000)) : 0;
  // Sprint 7.4/7.6 — o nio terminou com uma pergunta (e às vezes opções)
  const question = useMemo(() => pendingQuestion(chat), [chat]);
  const options = useMemo(() => questionOptions(chat), [chat]);

  if (splash) {
    return (
      <Box flexDirection="column" alignItems="center" paddingY={1}>
        <Text>{renderMatrixLogo({ width: Math.min(70, columns), height: 16 })}</Text>
        <Text color={theme.accent}>operador NIO · opencode/big-pickle</Text>
      </Box>
    );
  }

  const disabled = chat.busy || !ready;
  const pendingPerm = chat.permissions[0] ?? null;
  const overlayUp = overlay.kind !== 'none' || !!pendingPerm;
  const paletteOpen = draft.startsWith('/') && !overlayUp;
  // teto da área viva — encolhe quando a droplist `/` abre, pro total (live +
  // status + input + droplist + rodapé) caber e não corromper o Ink.
  const paletteMaxItems = Math.max(3, Math.min(6, rows - 16));
  const liveMax = Math.max(3, Math.floor(rows * 0.45) - (paletteOpen ? paletteMaxItems + 3 : 0));
  const inputActive = !overlayUp;
  const sessionTokens = chat.messages.reduce((n, m) => {
    const u = messageUsage(m);
    return n + (u ? u.tokensIn + u.tokensOut : 0);
  }, 0);

  // layout tipo Claude Code (Sprint 4): fluxo vertical, sem sidebar, rodapé de 1–2 linhas.
  return (
    <Box flexDirection="column" width={columns}>
      <Static items={finished}>{(m) => <MessageView key={m.id} message={m} />}</Static>

      {live && (
        <LiveMessage
          message={live}
          maxLines={liveMax}
          todos={chat.todos}
          files={chat.files}
          retry={chat.retry}
          expandReasoning={showReasoning}
        />
      )}
      <DiffSummary changes={chat.diff} />
      <StatusLine busy={chat.busy} frame={frame} seconds={elapsed} label={phase} />
      {chat.error && <ErrorBlock error={chat.error} />}
      <Toasts toasts={chat.toasts} />

      {/* Sprint 7.4 — o nio te perguntou algo e está esperando */}
      {question && !overlayUp && (
        <Box paddingX={1}>
          <Text color={theme.accentBright} wrap="truncate-end">
            {'↳ o nio perguntou: '}
            <Text color={theme.text}>{question.length > columns - 24 ? question.slice(0, columns - 27) + '…' : question}</Text>
          </Text>
        </Box>
      )}

      {/* o input NUNCA desmonta — o rascunho fica no App (Sprint 6). */}
      <InputBox
        value={draft}
        onChange={setDraft}
        disabled={disabled}
        active={inputActive}
        palette={palette}
        onSubmit={send}
        onDispatch={onDispatch}
        onCycleMode={cycleMode}
        options={overlayUp ? [] : options}
        width={Math.max(24, columns - 6)}
        maxItems={paletteMaxItems}
      />

      {/* camada por cima do input — não substitui, só sobrepõe. */}
      {pendingPerm ? (
        <PermissionModal req={pendingPerm} queued={chat.permissions.length} onRespond={respondPermission} />
      ) : overlay.kind === 'info' ? (
        <InfoPanel item={overlay.item} onClose={closeOverlay} />
      ) : overlay.kind === 'run' ? (
        <CommandRunner item={overlay.item} cwd={cwd} onClose={closeOverlay} />
      ) : null}

      <Footer
        model="big-pickle"
        cwd={cwd}
        session={session}
        mode={mode}
        sessionTokens={sessionTokens}
      />
    </Box>
  );
}
