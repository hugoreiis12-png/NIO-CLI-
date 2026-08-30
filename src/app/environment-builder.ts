/**
 * `EnvironmentBuilder` — materializa o ambiente de uma sessão a partir do
 * `Profile`. Orquestra (app layer): lê o catálogo (`ProfileCatalog`), garante os
 * toolchains (`ToolchainGateway`), resolve o `EnvironmentConfig` e devolve
 * também os `McpSpec[]` pra quem grava o `opencode.json`. Não faz IO de arquivo
 * direto — quem escreve é o `client-configs.ts` (MCPs) e o `SessionRepository`
 * (config); a instalação de toolchain fica no `adapters/pkg`.
 *
 * Fatia 2 (atual): MCPs + toolchains. envVars/aliases → dotfiles na Tarefa 5.
 * Falha parcial não aborta: toolchain que não materializa fica FORA do
 * `EnvironmentConfig` e volta como `EnsureResult { status: 'failed' }` pro
 * chamador avisar (o ambiente é incremental — a sessão já existe).
 *
 * Ver `docs/arch/ARQUITETURA-ENVIRONMENT-BUILDER.md`.
 */
import type { Profile, EnvironmentConfig } from '../core/types.js';
import type {
  ProfileCatalog,
  ToolchainGateway,
  ToolchainSpec,
  McpSpec,
  EnsureResult,
  EnvironmentRecipe,
} from '../core/environment.js';
import { createProfileCatalog, KNOWN_TOOLCHAINS, KNOWN_MCPS } from '../profiles/index.js';
import { createToolchainGateway } from '../adapters/pkg/toolchain-gateway.js';
import { nioLangMcp } from '../profiles/mcps.js';

/**
 * MCPs presentes em TODO perfil, mesclados antes dos específicos (dedupe por
 * `id`, o perfil vence se repetir). Hoje: o `nio-lang` (server nativo de
 * linguagens), base de todos os perfis. Novo perfil herda isto automaticamente.
 */
const BASE_MCPS: McpSpec[] = [nioLangMcp];

/** Junta base + perfil, sem duplicar por `id` (o perfil vence se repetir). */
function mergeMcps(base: McpSpec[], profile: McpSpec[]): McpSpec[] {
  const byId = new Map<string, McpSpec>();
  for (const m of [...base, ...profile]) byId.set(m.id, m);
  return [...byId.values()];
}

/** Junta as duas listas preservando ordem, sem repetir. */
function union(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])];
}

export interface BuiltEnvironment {
  /** Config resolvido pra persistir em `sessions.config` (só o que materializou). */
  config: EnvironmentConfig;
  /** MCPs do perfil (+ recipe), pra registrar no `opencode.json`. */
  mcps: McpSpec[];
  /** Resultado de cada toolchain — o chamador avisa sobre os `failed`. */
  toolchains: EnsureResult[];
  /** Ids de toolchain/MCP pedidos pela recipe que não existem no registro — o chamador avisa. */
  recipeWarnings: string[];
}

export class EnvironmentBuilder {
  constructor(
    private readonly catalog: ProfileCatalog = createProfileCatalog(),
    private readonly toolchains: ToolchainGateway = createToolchainGateway(),
  ) {}

  /**
   * Resolve o perfil (+ uma `EnvironmentRecipe` opcional, do repo NIO-SKILLS),
   * garante os toolchains e monta o `EnvironmentConfig`. **Lança** só se o perfil
   * não existe no catálogo. Toolchain que falha NÃO lança. Id de toolchain/MCP da
   * recipe que não está no registro (`KNOWN_*`) → entra em `recipeWarnings`,
   * ignorado (não vira `opencode.json` quebrado).
   */
  async build(profile: Profile, recipe?: EnvironmentRecipe): Promise<BuiltEnvironment> {
    const def = this.catalog.get(profile);
    const recipeWarnings: string[] = [];

    // Toolchains: os do perfil + os pedidos pela recipe (resolvidos no registro).
    const toolchainSpecs: ToolchainSpec[] = [...def.toolchains];
    for (const id of recipe?.toolchainIds ?? []) {
      if (toolchainSpecs.some((t) => t.id === id)) continue;
      const spec = KNOWN_TOOLCHAINS[id];
      if (spec) toolchainSpecs.push(spec);
      else recipeWarnings.push(`toolchain "${id}"`);
    }

    const toolchainResults: EnsureResult[] = [];
    for (const spec of toolchainSpecs) {
      toolchainResults.push(await this.toolchains.ensure(spec));
    }
    const materialized = toolchainResults
      .filter((r) => r.status === 'present' || r.status === 'installed')
      .map((r) => r.id);

    // MCPs: base + perfil + os da recipe.
    let mcps = mergeMcps(BASE_MCPS, def.mcps);
    if (recipe) {
      const extra: McpSpec[] = [];
      for (const id of recipe.mcpIds) {
        if (mcps.some((m) => m.id === id)) continue;
        const spec = KNOWN_MCPS[id];
        if (spec) extra.push(spec);
        else recipeWarnings.push(`MCP "${id}"`);
      }
      mcps = mergeMcps(mcps, extra);
    }

    const envVars = { ...def.envVars, ...recipe?.envVars };
    const aliases = { ...def.aliases, ...recipe?.aliases };

    const config: EnvironmentConfig = {
      languages: recipe ? union(def.languages, recipe.languages) : def.languages,
      frameworks: recipe ? union(def.frameworks, recipe.frameworks) : def.frameworks,
      mcps: mcps.map((m) => m.id),
    };
    if (materialized.length > 0) config.toolchains = materialized;
    if (Object.keys(envVars).length > 0) config.envVars = envVars;
    if (Object.keys(aliases).length > 0) config.aliases = aliases;
    if (recipe) config.extra = { ...config.extra, recipe: recipe.slug };

    return { config, mcps, toolchains: toolchainResults, recipeWarnings };
  }
}
