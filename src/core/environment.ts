/**
 * Domínio do ambiente materializável (v2) — vocabulário do `EnvironmentBuilder`.
 * Aqui vivem os SHAPES de entrada (o que um perfil declara) e os PORTS que os
 * adapters implementam. Sem IO nenhum (regra do hexágono): nada de `pg`, `fs` ou
 * `child_process`. O resultado RESOLVIDO da materialização é o `EnvironmentConfig`
 * (`core/session.ts`), que vai pro `sessions.config`.
 *
 * Ver `docs/v2/ARQUITETURA-ENVIRONMENT-BUILDER.md`.
 */
import type { Profile } from './session.js';

/**
 * Um MCP a registrar no cliente de IA. Formato OpenCode: `command` é o binário +
 * args juntos (array), `environment` são env vars do processo do MCP.
 */
export interface McpSpec {
  /** Chave do MCP no `opencode.json` (ex.: "postgres", "powerbi-modeling"). */
  id: string;
  command: string[];
  environment?: Record<string, string>;
}

/** Um toolchain/linguagem a garantir no host. */
export interface ToolchainSpec {
  /** Id lógico (ex.: "postgresql-client", "node", "python"). */
  id: string;
  /**
   * Globs — se qualquer um existir, o toolchain é considerado presente (não
   * reinstala). Mesmo mecanismo do `detect:` de dependências (`lib/dependencies`).
   */
  detect?: string[];
  /**
   * Plano de instalação, executado via `spawnSync` SEM shell (args em array).
   * Ausente = detectável mas não instalável pela CLI (só orienta).
   */
  install?: { program: string; args: string[] };
}

/**
 * Definição hardcoded de um perfil (`src/profiles/`) — o que ele materializa.
 * É a ENTRADA do `EnvironmentBuilder`; a saída resolvida é o EnviromentConfig (core/session.ts) 
 */
export interface ProfileDefinition {
  profile: Profile;
  languages: string[];
  toolchains: ToolchainSpec[];
  frameworks: string[];
  mcps: McpSpec[];
  envVars?: Record<string, string>;
  aliases?: Record<string, string>;
}

/**
 * Catálogo de perfis — port. A implementação (`src/profiles/`) é hardcoded no
 * fonte (regra da CLAUDE.md: novo perfil só entra alterando código).
 */
export interface ProfileCatalog {
  /**
   * Definição do perfil. **Lança** (não devolve `null`) se o perfil ainda não
   * tem ambiente modelado — os 6 valores de `Profile` são um union fechado, mas
   * nem todos têm definição durante a construção incremental.
   */
  get(profile: Profile): ProfileDefinition;
}

/**
 * Resultado de garantir um toolchain no host.
 *  - `present`   → já estava instalado (detectado, não reinstalou)
 *  - `installed` → instalado agora pela CLI
 *  - `failed`    → não detectado e (sem plano de instalação | plano falhou);
 *                  o chamador degrada (avisa, não entra no `EnvironmentConfig`)
 */
export interface EnsureResult {
  id: string;
  status: 'present' | 'installed' | 'failed';
  error?: string;
}

/**
 * Materializa toolchains/linguagens no host — port. A implementação
 * (`adapters/pkg/`) faz IO (detecção por glob + `spawnSync` sem shell). **Nunca
 * lança**: falha vira `status: 'failed'` (o ambiente é incremental, não aborta).
 */
export interface ToolchainGateway {
  ensure(spec: ToolchainSpec): Promise<EnsureResult>;
}
