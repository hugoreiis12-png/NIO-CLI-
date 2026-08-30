/**
 * Domínio do ambiente materializável (v2) — vocabulário do `EnvironmentBuilder`.
 * Aqui vivem os SHAPES de entrada (o que um perfil declara) e os PORTS que os
 * adapters implementam. Sem IO nenhum (regra do hexágono): nada de `pg`, `fs` ou
 * `child_process`. O resultado RESOLVIDO da materialização é o `EnvironmentConfig`
 * (`core/types.ts`), que vai pro `sessions.config`.
 *
 * Ver `docs/arch/ARQUITETURA-ENVIRONMENT-BUILDER.md`.
 */
import type { Profile, Ide } from './types.js';

/**
 * Um MCP a registrar no cliente de IA. **Exatamente um** de: `command` (local —
 * binário + args juntos, `type: 'local'`) ou `url` (remoto — endpoint HTTP,
 * `type: 'remote'`; ex.: Docker MCP Gateway). `environment` = env do processo.
 */
export interface McpSpec {
  /** Chave do MCP no `opencode.json` (ex.: "postgres", "powerbi-modeling", "docker"). */
  id: string;
  command?: string[];
  url?: string;
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
 * É a ENTRADA do `EnvironmentBuilder`; a saída resolvida é o EnviromentConfig (core/types.ts) 
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

  /** Todas as definições modeladas no catálogo (ordem de declaração). */
  list(): ProfileDefinition[];
}

/**
 * Preset de ambiente **vindo do repo NIO-SKILLS** (`recipes/<slug>.md`),
 * editável sem release da CLI (Sprint 5.2/5.3). Diferente do `ProfileDefinition`
 * (hardcoded, base) e da `LanguageRecipe` do nio-lang (nível-SDK): uma recipe é
 * uma combinação nomeada que **estende** um perfil fixo — nunca cria perfil novo
 * (regra da `CLAUDE.md`). O `EnvironmentBuilder` funde recipe sobre o perfil.
 */
export interface EnvironmentRecipe {
  slug: string;
  title: string;
  description: string;
  /** Perfil fixo que a recipe estende (um dos 6). */
  profile: Profile;
  languages: string[];
  frameworks: string[];
  /** Ids de `ToolchainSpec` conhecidos (`src/profiles/`). Id desconhecido → aviso, ignora. */
  toolchainIds: string[];
  /** Ids de `McpSpec` conhecidos (`src/profiles/mcps.ts`). Id desconhecido → aviso, ignora. */
  mcpIds: string[];
  envVars: Record<string, string>;
  aliases: Record<string, string>;
  /** Corpo do `.md` — notas pro operador de IA. */
  notes: string;
}

/**
 * Catálogo de recipes — port. A implementação (`adapters/skills/`) lê o cache
 * `~/.nio/skills/recipes/`. Best-effort: `recipes/` ausente → `list()` = `[]`.
 */
export interface RecipeCatalog {
  /** Recipes disponíveis; com `profile`, só as daquele perfil. */
  list(profile?: Profile): EnvironmentRecipe[];
  /** Recipe por slug, ou `null` se não existe / é inválida. */
  get(slug: string): EnvironmentRecipe | null;
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

/**
 * Resultado de abrir o editor da sessão na pasta do projeto.
 *  - `opened`      → editor lançado (processo detached, sobrevive à CLI)
 *  - `unavailable` → o `Ide` tem launcher mapeado, mas o binário não está no PATH
 *  - `skipped`     → o `Ide` da sessão não tem editor pra abrir (`terminal`/`other`)
 *  - `failed`      → o binário existia mas o lançamento falhou
 */
export interface OpenResult {
  ide: Ide;
  status: 'opened' | 'unavailable' | 'skipped' | 'failed';
  /** Binário efetivamente usado (ex.: "code", "code.cmd") quando resolvido. */
  binary?: string;
  error?: string;
}

/**
 * Abre o editor da sessão na pasta do projeto — port. A implementação
 * (`adapters/ide/`) detecta o binário e dispara detached (a IDE sobrevive ao fim
 * da CLI). **Nunca lança** (contrato, igual ao `ToolchainGateway`): toda falha
 * vira um `status` no `OpenResult`.
 */
export interface IdeGateway {
  open(ide: Ide, projectPath: string): Promise<OpenResult>;
}
