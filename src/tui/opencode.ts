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
