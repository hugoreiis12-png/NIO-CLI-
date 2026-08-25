import { env } from "../brand.js";

/**
 * Telemetria de uso best-effort. Nunca lança nem bloqueia. Desliga com `NIO_TELEMETRY=0`.
 *
 * NOTA (v2): o sink de telemetria do v1 foi removido na migração. `track()` é
 * **no-op** por ora — a interface segue pros call sites, mas não há destino até
 * um sink v2 existir.
 */

/** Um item provisionado: id sequencial estável (frontmatter) + nome de invocação. */
export interface Item {
  /** Id sequencial estável (frontmatter `id:`). `null` se ainda não atribuído. */
  id: string | null;
  /** Nome de invocação (pasta/arquivo). */
  name: string;
}

export interface ProvisionEvent {
  type: "provision";
  client: string;
  sections?: unknown;
  items: Item[];
  version: string;
}

export interface PromptEvent {
  type: "prompt";
  client: string;
  id: string | null;
  name: string;
}

export type UsageEvent = ProvisionEvent | PromptEvent;

function enabled(): boolean {
  return env("TELEMETRY") !== "0" && !env("NO_TELEMETRY");
}

/**
 * Items (skills/commands/agents) provisionados a partir do plano do `provision`,
 * já resolvidos pro id sequencial estável (via `uidByName`).
 */
export function provisionedItems(
  files: { relPath: string }[],
  uidByName: Map<string, string | null>,
): Item[] {
  const seen = new Set<string>();
  const items: Item[] = [];
  for (const f of files) {
    const m =
      /^skills\/([^/]+)\/SKILL\.md$/.exec(f.relPath) ??
      /^commands\/([^/]+)\.md$/.exec(f.relPath) ??
      /^agents\/([^/]+)\.md$/.exec(f.relPath);
    if (m && !seen.has(m[1])) {
      seen.add(m[1]);
      items.push({ name: m[1], id: uidByName.get(m[1]) ?? null });
    }
  }
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

// Requisições em voo — reservado pra quando existir um sink v2. Hoje sempre vazio
// (track é no-op), então `flushTelemetry` retorna de imediato.
const pending: Promise<unknown>[] = [];

/**
 * Registra um evento de uso. **No-op** enquanto não há sink v2 (o backend
 * Supabase saiu na migração). Mantida a assinatura por evento pros call sites;
 * `enabled()` continua respeitado pra quando um destino for plugado.
 */
export function track(event: UsageEvent): void {
  if (!enabled()) return;
  void event; // sem destino ainda — ver nota no topo do arquivo.
}

/**
 * Espera as requisições de telemetria em voo (com teto de tempo) antes do CLI sair.
 * Hoje não há requisições (track é no-op) — retorna imediato; mantida pra não
 * mudar os call sites e pra o dia em que um sink v2 existir.
 */
export async function flushTelemetry(timeoutMs = 4000): Promise<void> {
  if (pending.length === 0) return;
  const inflight = Promise.allSettled(pending.splice(0));
  await Promise.race([
    inflight,
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}
