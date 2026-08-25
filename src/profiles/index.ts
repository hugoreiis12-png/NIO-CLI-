/**
 * Catálogo de perfis — implementação hardcoded do port `ProfileCatalog`
 * (`core/environment.ts`). Novo perfil = novo arquivo aqui + entrada em
 * `DEFINITIONS`. Nenhum IO: só dados + resolução.
 */
import type { Profile } from '../core/session.js';
import type { ProfileCatalog, ProfileDefinition } from '../core/environment.js';
import { dbaProfile } from './dba.js';
import { fullstackProfile } from './fullstack.js';
import { analystProfile } from './analyst.js';
import { scientistProfile } from './scientist.js';
import { qaProfile } from './qa.js';
import { biProfile } from './bi.js';

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
}

export function createProfileCatalog(): ProfileCatalog {
  return new HardcodedProfileCatalog();
}
