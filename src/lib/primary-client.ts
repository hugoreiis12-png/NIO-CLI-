/**
 * Detecção do **cliente de IA primário** do `nio init` (Parte A da arquitetura
 * de clientes). OpenCode e Codex são os dois candidatos; o `nio init` sobe o que
 * estiver instalado no host. Ambos instalados → OpenCode vence por prioridade
 * (linhagem do operador fixo big-pickle), com override por `NIO_PRIMARY_CLIENT`
 * e escolha interativa no wizard (persistida em `nio.user.json`).
 *
 * É fato **da máquina** (depende do PATH local), não da `Session` — por isso
 * mora aqui e não em `sessions.config`.
 */
import { CLIENTS, isBinaryInstalled } from './client-install.js';
import { env } from '../brand.js';

export type PrimaryClient = 'opencode' | 'codex';

/** Ordem de preferência quando ambos estão instalados. */
export const PRIMARY_PRIORITY: readonly PrimaryClient[] = ['opencode', 'codex'] as const;

export function isPrimaryClient(value: unknown): value is PrimaryClient {
  return value === 'opencode' || value === 'codex';
}

export interface PrimaryDetection {
  /** Escolhido: override válido → hint válido → 1º da prioridade instalado → null. */
  chosen: PrimaryClient | null;
  /** Todos os primários encontrados no PATH, na ordem da prioridade. */
  installed: PrimaryClient[];
}

/**
 * Detecta os primários no PATH e resolve o escolhido. `isInstalled` é injetável
 * pra teste. `hint` (de `nio.user.json`) só vale se o binário existir; o
 * `NIO_PRIMARY_CLIENT` tem precedência sobre o hint, também só se instalado.
 */
export function detectPrimaryClient(
  hint?: string | null,
  isInstalled: (bin: string) => boolean = isBinaryInstalled,
): PrimaryDetection {
  const installed = PRIMARY_PRIORITY.filter((id) => isInstalled(CLIENTS[id]!.binary!));

  const override = env('PRIMARY_CLIENT');
  if (isPrimaryClient(override) && installed.includes(override)) {
    return { chosen: override, installed };
  }
  if (isPrimaryClient(hint) && installed.includes(hint)) {
    return { chosen: hint, installed };
  }
  return { chosen: installed[0] ?? null, installed };
}
