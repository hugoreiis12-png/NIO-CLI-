import { opencodeTarget, type ProvisionTarget } from './targets.js';

/** Decide se o auto-pull deve rodar. Pura: o usuário pode desligar explicitamente. */
export function shouldRunAutoPull(client: string | undefined, autoPullFlag: string | undefined): boolean {
  return autoPullFlag !== '0' && autoPullFlag !== 'false';
}

/** Só OpenCode por enquanto (decisão de 2026-07-27) — `client` fica no
 * parâmetro pra manter a assinatura estável se outro cliente voltar depois. */
export function pickProvisionTarget(client: string | undefined): ProvisionTarget {
  return opencodeTarget;
}
