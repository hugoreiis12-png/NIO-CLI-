/**
 * Aquece o cache de prefixo do backend antes de a pessoa terminar de digitar.
 *
 * Medido: a 1ª request custa ~31s e a 2ª ~1,6s. A diferença não é subir MCP nem o
 * `opencode serve` (2,5s somados) — é o **prefill** de ~21k tokens de prefixo
 * (system prompt ~8,6k + 56 schemas de tool ~12,6k) num KV cache frio. O prefixo é
 * estável entre sessões, então basta alguém pagar o prefill uma vez: o vLLM guarda e
 * as requests seguintes reaproveitam.
 *
 * A ideia é pagar esse custo **enquanto o usuário ainda digita**, numa sessão
 * descartável que produz o mesmo prefixo (mesmo modelo, mesmo agente → mesmas tools).
 */
import type { OpencodeClient } from '@opencode-ai/sdk';
import { tlog } from './debug.js';

/** Prompt mínimo: o que importa é o prefixo, não a resposta. */
const WARMUP_PROMPT = 'ok';

export interface WarmupDeps {
  client: OpencodeClient;
  model: { providerID: string; modelID: string };
  /** Mesmo agente da sessão real — agente diferente pode expor outro conjunto de tools. */
  agent: string;
  /**
   * Avisa o id assim que a sessão nasce. A TUI precisa dele ANTES da primeira resposta
   * pra descartar os eventos dela — `applyEvent` não filtra por sessão.
   */
  onSession?: (id: string) => void;
}

/** `sessionID` do evento, venha no topo ou dentro de `info`. */
export function eventSessionId(props: Record<string, unknown>): string {
  const direto = props.sessionID;
  if (typeof direto === 'string') return direto;
  const info = props.info as { sessionID?: unknown } | undefined;
  return typeof info?.sessionID === 'string' ? info.sessionID : '';
}

/**
 * Dispara o aquecimento e descarta a sessão. **Nunca lança e nunca bloqueia** o fluxo:
 * é otimização, não funcionalidade — falhar aqui só devolve a latência de antes.
 */
export async function warmPrefixCache(deps: WarmupDeps): Promise<boolean> {
  let sessionId = '';
  try {
    const created = await deps.client.session.create({ body: { title: 'aquecimento' } });
    sessionId = (created as { data?: { id?: string } }).data?.id ?? '';
    if (!sessionId) return false;
    deps.onSession?.(sessionId);
    await deps.client.session.prompt({
      path: { id: sessionId },
      body: { model: deps.model, agent: deps.agent, parts: [{ type: 'text', text: WARMUP_PROMPT }] },
    });
    return true;
  } catch (err) {
    tlog('aquecimento falhou', (err as Error).message);
    return false;
  } finally {
    // A sessão é lixo: sem isto ela apareceria no histórico do usuário.
    if (sessionId) await deps.client.session.delete({ path: { id: sessionId } }).catch(() => {});
  }
}
