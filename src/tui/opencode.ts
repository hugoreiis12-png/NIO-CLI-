/**
 * Wrapper fino sobre `@opencode-ai/sdk`: sobe o `opencode serve` headless (lê o
 * `opencode.json` — big-pickle + baseURL Headroom), devolve o client e um
 * iterador do stream de eventos (SSE) que **reconecta pra sempre**.
 */
import {
  createOpencodeServer,
  createOpencodeClient,
  type OpencodeClient,
  type Event,
} from '@opencode-ai/sdk';
import { tlog } from './debug.js';

export interface OpencodeHandle {
  client: OpencodeClient;
  url: string;
  close: () => void;
}

export async function startOpencode(cwd: string): Promise<OpencodeHandle> {
  const server = await createOpencodeServer({ hostname: '127.0.0.1', port: 0 });
  tlog('opencode serve em', server.url);
  const client = createOpencodeClient({ baseUrl: server.url, directory: cwd });
  return { client, url: server.url, close: () => server.close() };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Nomes dos agentes **primários** (modos que dá pra alternar com Tab — Sprint 5).
 * Fallback `['build', 'plan']` se o endpoint falhar / não existir.
 */
export async function listPrimaryAgents(client: OpencodeClient): Promise<string[]> {
  try {
    const res = await client.app.agents();
    const list = ((res as { data?: Array<{ name?: string; mode?: string }> }).data ?? [])
      .filter((a) => a.mode !== 'subagent' && a.name)
      .map((a) => a.name as string);
    return list.length > 0 ? list : ['build', 'plan'];
  } catch {
    return ['build', 'plan'];
  }
}

/**
 * Permissões pendentes AGORA (`GET /permission`) — a verdade do server, inclui
 * as de sub-agentes (`task`). O SDK não tipa esse endpoint; vai de `fetch` cru.
 * Nunca lança: erro/timeout → `[]`. O `resync` da TUI usa isto pra recuperar um
 * `permission.asked` perdido (senão o motor trava pra sempre em "processando").
 */
export async function fetchPendingPermissions(
  baseUrl: string,
): Promise<Array<Record<string, unknown>> | null> {
  try {
    const res = await fetch(new URL('/permission', baseUrl), {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return null; // falhou ≠ "sem pendências" — o caller não reconcilia
    const body = (await res.json()) as unknown;
    return Array.isArray(body) ? (body as Array<Record<string, unknown>>) : null;
  } catch {
    return null; // erro/timeout → null (mantém a fila como está, não apaga o modal)
  }
}

/**
 * Perguntas pendentes do tool `question` (`GET /session/:id/question`) — o `resync`
 * usa isto pra recuperar um `question.asked` perdido (senão o turno trava em
 * `running`). Nunca lança: erro/timeout → `[]`.
 */
export async function fetchPendingQuestions(
  baseUrl: string,
  sessionId: string,
): Promise<Array<Record<string, unknown>> | null> {
  if (!sessionId) return null; // sem sessão pra consultar → não reconcilia
  try {
    const res = await fetch(new URL(`/session/${sessionId}/question`, baseUrl), {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as unknown;
    return Array.isArray(body) ? (body as Array<Record<string, unknown>>) : null;
  } catch {
    return null; // erro/timeout → null (mantém a fila, não apaga a pergunta)
  }
}

/**
 * Stream de eventos do server. **Nunca para** enquanto `signal` não aborta — se o
 * SSE cai (fim de stream ou erro), reconecta com backoff. Emite `null` a cada
 * (re)conexão pra o caller re-sincronizar o estado.
 */
export async function* subscribeEvents(
  client: OpencodeClient,
  signal: AbortSignal,
): AsyncGenerator<Event | null> {
  let backoff = 500;
  while (!signal.aborted) {
    try {
      const res = await client.event.subscribe();
      yield null; // sinal de "(re)conectado — re-sincronize"
      backoff = 500;
      for await (const evt of res.stream) {
        if (signal.aborted) return;
        yield evt as Event;
      }
      tlog('event stream terminou — reconectando');
    } catch (err) {
      tlog('event stream erro', (err as Error).message);
    }
    if (signal.aborted) return;
    await sleep(backoff);
    backoff = Math.min(backoff * 2, 5000);
  }
}
