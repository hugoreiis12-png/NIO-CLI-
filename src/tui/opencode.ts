/**
 * Wrapper fino sobre `@opencode-ai/sdk`: sobe o `opencode serve` headless (lê o
 * `opencode.json` — big-pickle + baseURL Headroom), devolve o client e um
 * iterador do stream de eventos (SSE).
 */
import {
  createOpencodeServer,
  createOpencodeClient,
  type OpencodeClient,
  type Event,
} from '@opencode-ai/sdk';
import { dlog } from '../lib/debug.js';

export interface OpencodeHandle {
  client: OpencodeClient;
  url: string;
  close: () => void;
}

/** Sobe o server e conecta o client, escopado em `cwd`. Lança se o server não subir. */
export async function startOpencode(cwd: string): Promise<OpencodeHandle> {
  const server = await createOpencodeServer({ hostname: '127.0.0.1', port: 0 });
  dlog('tui: opencode serve em', server.url);
  const client = createOpencodeClient({ baseUrl: server.url, directory: cwd });
  return { client, url: server.url, close: () => server.close() };
}

/**
 * Stream de eventos do server (SSE). Re-tenta uma vez em caso de queda; para
 * quando `signal` aborta.
 */
export async function* subscribeEvents(
  client: OpencodeClient,
  signal?: AbortSignal,
): AsyncGenerator<Event> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await client.event.subscribe();
      for await (const evt of res.stream) {
        if (signal?.aborted) return;
        yield evt as Event;
      }
      return;
    } catch (err) {
      dlog('tui: event stream caiu', (err as Error).message);
      if (signal?.aborted) return;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}
