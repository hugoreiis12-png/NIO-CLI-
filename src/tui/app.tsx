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
  AttachChips,
  type PaletteAction,
} from './components.js';
import { InfoPanel, CommandRunner, PermissionModal } from './palette.js';
import { QuestionModal } from './question-modal.js';
import { buildPalette, type PaletteItem } from './palette-source.js';
import {
  applyEvent,
  contextUsage,
  shouldCompact,
  pendingQuestion,
  questionOptions,
  pushUserMessage,
  shouldAbortCompaction,
  toolAttempts,
  failedTools,
  syncMessages,
  reconcilePendingPermissions,
  reconcilePendingQuestions,
  emptyChat,
  type ChatState,
} from './state.js';
import {
  listPrimaryAgents,
  subscribeEvents,
  fetchPendingPermissions,
  fetchPendingQuestions,
  type OpencodeHandle,
} from './opencode.js';
import { NIO_AI_CONTEXT, NIO_AI_WARMUP, compactionReserved } from '../lib/clients/client-configs.js';
import { compactInput } from '../lib/exec/map-reduce.js';
import { buildAttachedInput, detectPaths } from './attachments.js';
import { buildHandoffDigest } from './context-recovery.js';
import { warmPrefixCache, eventSessionId } from './warmup.js';
import { buildLedger, ledgerTotal, hasWorkInFlight } from './token-ledger.js';
import { learnTurn, remindLessons, creditLessons } from './learning-wire.js';
import type { InjectedLesson } from '../app/lesson-outcome.js';
import type { FilePartInput } from '@opencode-ai/sdk';

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
  // Rótulos do modelo (só exibição) — refletem o modelo REAL passado pela TUI;
  // fallback só quando nenhum `model` foi injetado (testes/probe).
  const engineLabel = model ? `${model.providerID}/${model.modelID}` : 'opencode/big-pickle';
  const modelLabel = model ? model.modelID : 'big-pickle';
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
  const userTurnActive = useRef(false); // turno em curso foi pedido pelo usuário? (senão = compactação/emenda → aborta)
  // O loop de eventos vive num closure criado na montagem: sem este ref ele leria um
  // `chat` velho pra sempre. Atualizado a cada render.
  const chatRef = useRef(chat);
  chatRef.current = chat;
  // Lições injetadas no prompt atual + quantas tentativas já existiam quando ele saiu:
  // o crédito só olha o que aconteceu DEPOIS da injeção.
  const injectedLessons = useRef<InjectedLesson[]>([]);
  const attemptsAtSend = useRef(0);
  /** Chars do prompt em voo — vira o `pending` do livro-caixa. 0 = nada pendente. */
  const inFlightChars = useRef(0);
  const warmupSessionId = useRef(''); // sessão descartável do aquecimento — eventos dela são ignorados
  const compactingRef = useRef(false); // Frente 5 — já disparou a compactação proativa? (evita duplicar)

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
      const [st, msgs, perms, ques] = await Promise.all([
        handle.client.session.status(),
        handle.client.session.messages({ path: { id } }),
        fetchPendingPermissions(handle.url),
        fetchPendingQuestions(handle.url, id),
      ]);
      const status = (st as { data?: Record<string, { type?: string }> }).data?.[id]?.type;
      const busy = status === 'busy' || status === 'retry';
      const raw = ((msgs as { data?: unknown[] }).data ?? []) as Parameters<typeof syncMessages>[1];
      setChat((prev) =>
        reconcilePendingQuestions(reconcilePendingPermissions(syncMessages(prev, raw, busy), perms), ques),
      );
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
      // Aquece o prefixo ENQUANTO a pessoa digita: paga o prefill de ~21k tokens numa
      // sessão descartável pra a 1ª request real cair no cache (medido: 31s → ~1,6s).
      if (model && NIO_AI_WARMUP) {
        void warmPrefixCache({
          client: handle.client,
          model,
          agent: mode,
          onSession: (id) => { warmupSessionId.current = id; },
        }).then((ok) => tlog('aquecimento', ok ? 'ok' : 'falhou'));
      }
      for await (const evt of subscribeEvents(handle.client, ac.signal)) {
        if (!alive) break;
        if (evt === null) {
          void resync(); // (re)conectou → re-sincroniza
          continue;
        }
        const et = evt.type as string;
        if (et === 'message.part.delta') continue; // ruído: o snapshot vem em message.part.updated
        // Sprint — "respondeu = parou": o turno do usuário fecha no idle; se o motor
        // emenda OUTRO turno (compactação/continuação) sem prompt novo, encerra e fica idle.
        const props = (evt as { properties?: Record<string, unknown> }).properties ?? {};
        // O aquecimento roda numa sessão própria; `applyEvent` não filtra por sessão,
        // então sem isto a resposta descartável dele apareceria no chat do usuário.
        if (warmupSessionId.current && eventSessionId(props) === warmupSessionId.current) continue;
        const stType = (props.status as { type?: string } | undefined)?.type;
        if (et === 'session.idle' || (et === 'session.status' && stType === 'idle')) {
          userTurnActive.current = false;
          // Turno fechado: o que errou e depois acertou vira lição. Assíncrono e
          // silencioso — aprender não pode atrasar nem derrubar a interface.
          void learnTurn(chatRef.current.messages, session?.profile);
          // Credita as lições do prompt que acabou de fechar, olhando só o que veio
          // depois dele — e zera, pra não creditar duas vezes no próximo idle.
          if (injectedLessons.current.length > 0) {
            const novas = toolAttempts(chatRef.current.messages).slice(attemptsAtSend.current);
            void creditLessons(injectedLessons.current, novas);
            injectedLessons.current = [];
          }
        }
        const info = (props.info ?? props) as { mode?: string };
        // emenda não-solicitada = compactação/resumo que o motor dispara sozinho após
        // a resposta (o modelo não inicia turno novo por conta própria fora disso).
        if (
          et === 'message.updated' &&
          info.mode === 'compaction' &&
          shouldAbortCompaction({
            userTurnActive: userTurnActive.current,
            requestedByTui: compactingRef.current,
            workInFlight: inFlightChars.current > 0,
          })
        ) {
          if (sessionId.current) handle.client.session.abort({ path: { id: sessionId.current } }).catch(() => {});
          setChat((prev) => ({ ...prev, busy: false }));
          continue;
        }
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
    { isActive: overlay.kind === 'none' && chat.permissions.length === 0 && chat.questions.length === 0 },
  );

  useEffect(() => () => handle.close(), [handle]);

  const send = async (text: string) => {
    if (!sessionId.current) return;
    setDraft('');
    userTurnActive.current = true; // este turno foi pedido pelo usuário → não abortar
    setChat((prev) => pushUserMessage(prev, text)); // eco mostra o texto ORIGINAL
    // Anexos: embute o conteúdo dos arquivos (csv/txt/xlsx) no texto e coleta parts de
    // imagem (Item 4b). Falha → segue com o texto cru.
    let enriched = text;
    let fileParts: FilePartInput[] = [];
    try {
      const built = await buildAttachedInput(text);
      enriched = built.text;
      fileParts = built.fileParts;
    } catch (err) {
      tlog('buildAttachedInput falhou, texto cru', (err as Error).message);
    }
    // Lição das tools que já falharam NESTA sessão — o filtro por tool é o que impede
    // a lição de uma ferramenta de contaminar outra (similaridade sozinha não separa).
    try {
      attemptsAtSend.current = toolAttempts(chat.messages).length;
      const pista = await remindLessons(failedTools(chat.messages), text);
      injectedLessons.current = pista.injected;
      if (pista.text) enriched = `${pista.text}

${enriched}`;
    } catch (err) {
      tlog('recall de lições falhou', (err as Error).message);
    }
    // Map-reduce: input grande é compactado (lossy) antes de enviar; erro → manda cru.
    let payload = enriched;
    try {
      payload = await compactInput(enriched, {
        onProgress: (n) => toast(`compactando input · ${n} trecho(s)`),
      });
    } catch (err) {
      tlog('compactInput falhou, enviando cru', (err as Error).message);
    }
    // Sem o antigo sufixo `/no_think` (poluía o contexto). O reasoning do Qwen não é
    // suprimível via config do opencode (ver client-configs) — a Camada B não o mostra no output.
    inFlightChars.current = payload.length; // em voo até a resposta (ou o erro) voltar
    handle.client.session
      .prompt({ path: { id: sessionId.current }, body: { model, agent: mode, parts: [...fileParts, { type: 'text', text: payload }] } })
      .catch((err) => tlog('prompt falhou', (err as Error).message))
      .finally(() => { inFlightChars.current = 0; }); // voltou (ou falhou): nada pendente
  };

  /**
   * Janela estourada: cria uma sessão nova e semeia com um resumo montado LOCALMENTE.
   *
   * Não dá pra usar o `session.summarize` aqui — é ele que estoura, porque reenvia o
   * histórico inteiro pro modelo resumir. Era isso que deixava a sessão morta: a
   * recuperação falhava pelo mesmo motivo do erro original, em toda request seguinte.
   */
  const recoverFromOverflow = async () => {
    const digest = buildHandoffDigest(chat.messages);
    try {
      const created = await handle.client.session.create({ body: { title: `${cwd.split('/').pop() ?? 'nio'} (cont.)` } });
      const novaId = (created as { data?: { id?: string } }).data?.id ?? '';
      if (!novaId) throw new Error('sessão nova sem id');
      sessionId.current = novaId;
      setChat((prev) => ({ ...prev, error: null, busy: false }));
      toast('janela zerada — sessão nova com o resumo da anterior');
      if (digest) {
        await handle.client.session.prompt({
          path: { id: novaId },
          body: { model, agent: mode, parts: [{ type: 'text', text: digest }] },
        });
      }
    } catch (err) {
      tlog('recuperação do overflow falhou', (err as Error).message);
      toast('não consegui zerar a janela — saia e entre de novo', 'warning');
    }
  };

  // Recupera sozinho: deixar o usuário reenviar só repetiria o mesmo erro.
  useEffect(() => {
    if (chat.error?.name === 'ContextOverflowError') void recoverFromOverflow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.error?.name]);

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

  // Frente 5 — compactação proativa: quando o turno acaba (idle) e o contexto já
  // cruzou o teto menos a folga, dispara `session.summarize` AGORA (ocioso, o
  // usuário está lendo) — o próximo prompt não paga a compactação inline (a trava
  // de "demora pra continuar após estourar"). Mesma sessão, contexto vira resumo.
  useEffect(() => {
    if (chat.busy || !sessionId.current) return;
    // Livro-caixa: conta a partir do ÚLTIMO RESUMO, não do início da sessão. Somar o
    // histórico inteiro faria o orçamento parecer estourado logo após compactar.
    const ledger = buildLedger(chat.messages, inFlightChars.current);
    if (hasWorkInFlight(ledger)) return; // há request em voo: não mexer na sessão
    if (!shouldCompact(ledgerTotal(ledger), NIO_AI_CONTEXT, compactionReserved())) {
      compactingRef.current = false; // abaixo do teto (pós-compactação) → re-arma
      return;
    }
    if (compactingRef.current) return; // já disparou; aguardando o motor compactar
    compactingRef.current = true;
    handle.client.session
      .summarize({ path: { id: sessionId.current } })
      .catch(() => {
        compactingRef.current = false; // falhou → re-arma pra tentar de novo
      });
    toast('compactando o contexto proativamente…');
  }, [chat.busy, chat.messages, handle]);

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
        if (sessionId.current) {
          compactingRef.current = true; // fomos nós: o guard abaixo não pode matar
          handle.client.session
            .summarize({ path: { id: sessionId.current } })
            .catch(() => { compactingRef.current = false; });
        }
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

  // Tool `question` — responde/rejeita via REST (`/session/:id/question/:id/reply|reject`,
  // o SDK não tipa) e faz shift na fila. Sem isto o turno trava em `running`.
  const settleQuestion = (path: 'reply' | 'reject', answers?: string[][]) => {
    const q = chat.questions[0];
    if (!q) return;
    setChat((prev) => ({ ...prev, questions: prev.questions.slice(1) }));
    fetch(new URL(`/session/${q.sessionId}/question/${q.id}/${path}`, handle.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: answers ? JSON.stringify({ answers }) : undefined,
    })
      .catch((err) => tlog('question respond falhou', (err as Error).message))
      .finally(() => void resync());
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
  // uso da janela de contexto do último turno (input de pico + output gerado), pra
  // o rodapé medir o gasto contra a janela do provider. Só muda no `step-finish`;
  // recalcular a cada frame do spinner era desperdício (o tick não muda as mensagens).
  const usage = useMemo(() => contextUsage(chat.messages), [chat.messages]);
  // Item 4 — arquivos detectados no rascunho (chips acima do input). fs-based, mas
  // barato e memoizado no draft (só alguns tokens por vez).
  const attachLabels = useMemo(
    () => detectPaths(draft).map((d) => `${d.path.split(/[\\/]/).pop() ?? d.path} [${d.kind}]`),
    [draft],
  );

  if (splash) {
    return (
      <Box flexDirection="column" alignItems="center" paddingY={1}>
        <Text>{renderMatrixLogo({ width: Math.min(70, columns), height: 16 })}</Text>
        <Text color={theme.accent}>operador NIO · {engineLabel}</Text>
      </Box>
    );
  }

  const disabled = chat.busy || !ready;
  const pendingPerm = chat.permissions[0] ?? null;
  const pendingQ = !pendingPerm ? (chat.questions[0] ?? null) : null; // permissão tem prioridade
  const overlayUp = overlay.kind !== 'none' || !!pendingPerm || !!pendingQ;
  const paletteOpen = draft.startsWith('/') && !overlayUp;
  // teto da área viva — encolhe quando a droplist `/` abre, pro total (live +
  // status + input + droplist + rodapé) caber e não corromper o Ink.
  const paletteMaxItems = Math.max(3, Math.min(6, rows - 16));
  const liveMax = Math.max(3, Math.floor(rows * 0.45) - (paletteOpen ? paletteMaxItems + 3 : 0));
  const inputActive = !overlayUp;

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

      {/* Item 4 — chips dos arquivos detectados no rascunho, acima do input. */}
      {!overlayUp && <AttachChips files={attachLabels} />}

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
      ) : pendingQ ? (
        <QuestionModal
          req={pendingQ}
          queued={chat.questions.length}
          onAnswer={(answers) => settleQuestion('reply', answers)}
          onReject={() => settleQuestion('reject')}
        />
      ) : overlay.kind === 'info' ? (
        <InfoPanel item={overlay.item} onClose={closeOverlay} />
      ) : overlay.kind === 'run' ? (
        <CommandRunner item={overlay.item} cwd={cwd} onClose={closeOverlay} />
      ) : null}

      <Footer
        model={modelLabel}
        cwd={cwd}
        session={session}
        mode={mode}
        tokensIn={usage.tokensIn}
        tokensOut={usage.tokensOut}
        contextLimit={NIO_AI_CONTEXT}
      />
    </Box>
  );
}
