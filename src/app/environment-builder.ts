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
 * Ver `docs/v2/ARQUITETURA-ENVIRONMENT-BUILDER.md` e `TASK-environment-builder.md`.
 */
import type { Profile, EnvironmentConfig } from '../core/session.js';
import type { ProfileCatalog, ToolchainGateway, McpSpec, EnsureResult } from '../core/environment.js';
import { createProfileCatalog } from '../profiles/index.js';
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

export interface BuiltEnvironment {
  /** Config resolvido pra persistir em `sessions.config` (só o que materializou). */
  config: EnvironmentConfig;
  /** MCPs do perfil, pra registrar no `opencode.json`. */
  mcps: McpSpec[];
  /** Resultado de cada toolchain — o chamador avisa sobre os `failed`. */
  toolchains: EnsureResult[];
}

export class EnvironmentBuilder {
  constructor(
    private readonly catalog: ProfileCatalog = createProfileCatalog(),
    private readonly toolchains: ToolchainGateway = createToolchainGateway(),
  ) {}

  /**
   * Resolve o perfil, garante os toolchains e monta o `EnvironmentConfig`.
   * **Lança** só se o perfil não existe no catálogo (o chamador degrada — a
   * sessão já existe). Toolchain que falha NÃO lança: sai em `toolchains` com
   * `status: 'failed'` e fica fora do `config`.
   */
  async build(profile: Profile): Promise<BuiltEnvironment> {
    const def = this.catalog.get(profile);

    const toolchainResults: EnsureResult[] = [];
    for (const spec of def.toolchains) {
      toolchainResults.push(await this.toolchains.ensure(spec));
    }
    const materialized = toolchainResults
      .filter((r) => r.status === 'present' || r.status === 'installed')
      .map((r) => r.id);

    const mcps = mergeMcps(BASE_MCPS, def.mcps);

    const config: EnvironmentConfig = {
      languages: def.languages,
      frameworks: def.frameworks,
      mcps: mcps.map((m) => m.id),
    };
    if (materialized.length > 0) config.toolchains = materialized;
    if (def.envVars && Object.keys(def.envVars).length > 0) config.envVars = def.envVars;
    if (def.aliases && Object.keys(def.aliases).length > 0) config.aliases = def.aliases;

    return { config, mcps, toolchains: toolchainResults };
  }
}
