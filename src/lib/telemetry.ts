import type { DbClient } from "../adapters/supabase/client.js";
import { env } from "../brand.js";

/**
 * Telemetria de uso best-effort: o backend atribui o usuário via `auth.uid()` do JWT,
 * então não mandamos PII. Nunca lança nem bloqueia. Desliga com `NIO_TELEMETRY=0`.
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

// Requisições em voo — o CLI é curto e pode encerrar antes do POST completar,
// então guardamos as promises pra dar flush (`flushTelemetry`) antes de sair.
const pending: Promise<unknown>[] = [];

/** Envia um evento de uso pro NOS. Best-effort, nunca lança. */
export function track(supabase: DbClient | null, event: UsageEvent): void {
  if (!supabase || !enabled()) return;
  const p = supabase.functions
    .invoke("track-usage", { body: { ...event, at: new Date().toISOString() } })
    .then(() => undefined)
    .catch(() => {
      /* telemetria nunca quebra o fluxo */
    });
  pending.push(p);
}

/**
 * Espera as requisições de telemetria em voo (com teto de tempo) antes do CLI sair.
 * No servidor MCP (long-lived) não é necessário — o loop já mantém o processo vivo.
 */
export async function flushTelemetry(timeoutMs = 4000): Promise<void> {
  if (pending.length === 0) return;
  const inflight = Promise.allSettled(pending.splice(0));
  await Promise.race([
    inflight,
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}
