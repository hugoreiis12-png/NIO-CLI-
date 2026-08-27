import { opencodeTarget, codexTarget, type ProvisionTarget } from './targets.js';

/** Decide se o auto-pull deve rodar. Pura: o usuário pode desligar explicitamente. */
export function shouldRunAutoPull(client: string | undefined, autoPullFlag: string | undefined): boolean {
  return autoPullFlag !== '0' && autoPullFlag !== 'false';
}

/** Alvo do auto-pull pelo `NIO_CLIENT` do processo do MCP server. Codex → `~/.codex`
 * (skills traduzidas); o resto (opencode, vazio) → `~/.config/opencode`. */
export function pickProvisionTarget(client: string | undefined): ProvisionTarget {
  return client === 'codex' ? codexTarget : opencodeTarget;
}
