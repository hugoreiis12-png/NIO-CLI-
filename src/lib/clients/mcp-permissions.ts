/**
 * Regras `permission: ask` derivadas de `McpSpec.askTools`. O opencode nomeia a tool de
 * um MCP `<id do server>_<tool>`, e o schema do config aceita essa chave em `permission`
 * (verificado em opencode.ai/config.json e no `opencode debug config` 1.18.33).
 *
 * Só escreve `ask` — nunca `allow`: ordem de regra com curinga é ambígua e o que não
 * declaramos já cai no default do cliente. A regra do usuário vence a nossa.
 */
import type { McpSpec } from '../../core/environment.js';

export type AskRules = Record<string, 'ask'>;

export function mcpAskRules(specs: McpSpec[]): AskRules {
  const rules: AskRules = {};
  for (const spec of specs) {
    for (const tool of spec.askTools ?? []) rules[`${spec.id}_${tool}`] = 'ask';
  }
  return rules;
}

/** Objeto de `permission` → funde as regras por baixo. Forma string (`"allow"`) fica intacta. */
export function withMcpAskRules(permission: unknown, specs: McpSpec[]): unknown {
  const rules = mcpAskRules(specs);
  if (Object.keys(rules).length === 0) return permission;
  if (permission === undefined || permission === null) return rules;
  if (typeof permission !== 'object') return permission;
  return { ...rules, ...(permission as Record<string, unknown>) };
}

/** Alguma regra nossa ainda não está no `permission` do usuário (nem ele a sobrepôs)? */
export function hasMissingAskRules(permission: unknown, specs: McpSpec[]): boolean {
  if (typeof permission !== 'object' || permission === null) return false;
  const have = permission as Record<string, unknown>;
  return Object.keys(mcpAskRules(specs)).some((k) => !(k in have));
}
