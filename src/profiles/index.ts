/**
 * Catálogo de perfis — implementação hardcoded do port `ProfileCatalog`
 * (`core/environment.ts`). Novo perfil = novo arquivo aqui + entrada em
 * `DEFINITIONS`. Nenhum IO: só dados + resolução.
 */
import type { Profile } from '../core/types.js';
import type { ProfileCatalog, ProfileDefinition, McpSpec, ToolchainSpec } from '../core/environment.js';
import { dbaProfile } from './dba.js';
import { fullstackProfile } from './fullstack.js';
import { analystProfile } from './analyst.js';
import { scientistProfile } from './scientist.js';
import { qaProfile } from './qa.js';
import { biProfile } from './bi.js';
import { nioLangMcp, postgresMcp, powerbiMcp, n8nMcp, dockerGatewayMcp } from './mcps.js';
import { nodeToolchain, pythonToolchain } from './toolchains.js';

/** Catálogo completo dos 6 perfis (`sessions.profile`). */
const DEFINITIONS: Record<Profile, ProfileDefinition> = {
  fullstack: fullstackProfile,
  analyst: analystProfile,
  scientist: scientistProfile,
  dba: dbaProfile,
  qa: qaProfile,
  bi: biProfile,
};

class HardcodedProfileCatalog implements ProfileCatalog {
  get(profile: Profile): ProfileDefinition {
    const def = DEFINITIONS[profile];
    if (!def) {
      const disponiveis = Object.keys(DEFINITIONS).join(', ') || '(nenhum)';
      throw new Error(
        `Perfil "${profile}" ainda não tem ambiente definido no catálogo ` +
          `(src/profiles/). Perfis disponíveis: ${disponiveis}.`,
      );
    }
    return def;
  }

  list(): ProfileDefinition[] {
    return Object.values(DEFINITIONS);
  }
}

export function createProfileCatalog(): ProfileCatalog {
  return new HardcodedProfileCatalog();
}

/**
 * Specs conhecidos por id — o `EnvironmentBuilder` usa pra resolver os
 * `toolchainIds`/`mcpIds` de uma `EnvironmentRecipe` (Sprint 5). Cobre os
 * reutilizados + os inline dos perfis + os que só entram por wizard (n8n). Id
 * fora daqui numa recipe → aviso, ignora (não gera `opencode.json` quebrado).
 */
export const KNOWN_TOOLCHAINS: Record<string, ToolchainSpec> = Object.fromEntries(
  [nodeToolchain, pythonToolchain, ...Object.values(DEFINITIONS).flatMap((d) => d.toolchains)].map((t) => [
    t.id,
    t,
  ]),
);

export const KNOWN_MCPS: Record<string, McpSpec> = Object.fromEntries(
  [nioLangMcp, postgresMcp, powerbiMcp, n8nMcp, dockerGatewayMcp].map((m) => [m.id, m]),
);
