/**
 * Decide se uma tool roda sem humano. Puro — a lista vem do perfil
 * (`ProfileDefinition.autoApprove`, obrigatória nos 6).
 *
 * Duas fontes de permissão, com pesos diferentes de propósito:
 *  - **allowlist do perfil**: padrão estável, vale para toda task daquele perfil.
 *  - **concessão pontual**: o que o humano liberou com `nio task approve`, ligado
 *    a UMA task. Não vaza para outras nem sobrevive a ela.
 *
 * O default é `park`, nunca `deny`: negar em silêncio faz o modelo seguir sem a
 * ferramenta e entregar meia resposta; estacionar devolve a decisão a quem pode
 * tomá-la.
 */
import type { PermissionDecider, PermissionDecision } from '../core/agent.js';
import type { Profile } from '../core/types.js';
import type { ProfileCatalog } from '../core/environment.js';
import { createProfileCatalog } from '../profiles/index.js';

/**
 * Converte `nio_fabric_*` em regex. Só `*` é curinga; todo o resto é literal,
 * incluindo `.` — sem escapar, `nio.fabric` casaria com `nio_fabric`.
 */
export function globParaRegex(padrao: string): RegExp {
  const escapado = padrao.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escapado}$`);
}

/** `true` se `tool` casa com algum padrão da lista. Lista vazia = nada casa. */
export function casaAlgum(tool: string, padroes: readonly string[]): boolean {
  return padroes.some((p) => globParaRegex(p).test(tool));
}

export interface ApprovalPolicyOpts {
  /**
   * Concessões pontuais desta task (`tasks.approved_tools`). Casam por nome
   * exato: o humano aprovou `bash`, não `bash*`.
   */
  approved?: readonly string[];
  catalog?: ProfileCatalog;
}

export function createApprovalPolicy(opts: ApprovalPolicyOpts = {}): PermissionDecider {
  const catalog = opts.catalog ?? createProfileCatalog();
  const aprovadas = opts.approved ?? [];
  return {
    decide(toolName: string, profile: Profile): PermissionDecision {
      if (aprovadas.includes(toolName)) return 'allow';
      const def = catalog.get(profile);
      return casaAlgum(toolName, def.autoApprove) ? 'allow' : 'park';
    },
  };
}
