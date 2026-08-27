/**
 * `SessionManager` — camada de app do ciclo de vida da `Session` v2 (ambiente).
 * Orquestra o `SessionRepository` (persistência + invariante 1-ativa-por-usuário)
 * e o `EnvironmentBuilder` (materialização do perfil). É o ponto ÚNICO que a CLI
 * (`nio sessions`, `nio init`) e as tools MCP (`nio_session_*`, `nio_env_*`)
 * usam — nenhuma dessas superfícies fala com o repo/builder direto.
 *
 * Resolução por prefixo de UUID mora aqui (o usuário/IA nunca digita o id
 * inteiro). Erros de resolução são tipados (`SessionNotFoundError`,
 * `AmbiguousSessionError`) pra cada superfície formatar a mensagem do seu jeito.
 *
 * Sem IO direto: o repo e o builder são injetáveis (default = implementações
 * reais), então os testes rodam sem banco nem subprocesso.
 */
import type {
  Session,
  SessionStatus,
  Profile,
  Ide,
  EnvironmentConfig,
} from '../core/session.js';
import type { SessionRepository } from '../core/repositories.js';
import type { McpSpec, EnsureResult, EnvironmentRecipe, RecipeCatalog } from '../core/environment.js';
import { createSessionRepository } from '../adapters/pg/session-repository.js';
import { createRecipeCatalog } from '../adapters/skills/recipe-catalog.js';
import { EnvironmentBuilder } from './environment-builder.js';

/** Nenhuma sessão do usuário casa com o prefixo pedido. */
export class SessionNotFoundError extends Error {
  constructor(prefix: string) {
    super(`Nenhuma sessão começa com "${prefix}".`);
    this.name = 'SessionNotFoundError';
  }
}

/** Mais de uma sessão casa com o prefixo — precisa de mais caracteres. */
export class AmbiguousSessionError extends Error {
  constructor(
    prefix: string,
    readonly count: number,
  ) {
    super(`Ambíguo: ${count} sessões começam com "${prefix}". Use mais caracteres.`);
    this.name = 'AmbiguousSessionError';
  }
}

/** Match por prefixo de UUID. Puro — testável isolado. */
export function matchByIdPrefix(sessions: Session[], prefix: string): Session[] {
  return sessions.filter((s) => s.id.startsWith(prefix));
}

export interface CreateSessionInput {
  userId: number;
  name: string;
  profile: Profile;
  projectPath: string;
  ide: Ide;
  /** Preset de ambiente do repo NIO-SKILLS a fundir sobre o perfil (Sprint 5). */
  recipe?: EnvironmentRecipe;
}

/** Sessão + o ambiente resolvido a partir do perfil (+ recipe). */
export interface MaterializedSession {
  session: Session;
  config: EnvironmentConfig;
  /** MCPs do ambiente, pra quem quiser registrar num cliente de IA (a CLI escreve o `opencode.json`; a tool MCP só devolve). */
  mcps: McpSpec[];
  /** Resultado de cada toolchain — o chamador avisa sobre os `failed`. */
  toolchains: EnsureResult[];
  /** Ids de toolchain/MCP da recipe que não existem no registro — o chamador avisa. */
  recipeWarnings: string[];
  /**
   * Preenchido quando a sessão foi criada mas a materialização do ambiente
   * falhou (o ambiente é incremental — a sessão já existe e é válida).
   */
  materializeError?: string;
}

export class SessionManager {
  constructor(
    private readonly repo: SessionRepository = createSessionRepository(),
    private readonly builder: EnvironmentBuilder = new EnvironmentBuilder(),
    private readonly recipes: RecipeCatalog = createRecipeCatalog(),
  ) {}

  list(userId: number): Promise<Session[]> {
    return this.repo.listByUser(userId);
  }

  findActive(userId: number): Promise<Session | null> {
    return this.repo.findActiveByUser(userId);
  }

  /** Resolve uma sessão do usuário pelo prefixo do id. Lança se ausente ou ambíguo. */
  async resolve(userId: number, idPrefix: string): Promise<Session> {
    const all = await this.repo.listByUser(userId);
    const matches = matchByIdPrefix(all, idPrefix);
    if (matches.length === 1) return matches[0]!;
    if (matches.length === 0) throw new SessionNotFoundError(idPrefix);
    throw new AmbiguousSessionError(idPrefix, matches.length);
  }

  /**
   * Prefixo vazio/ausente → a sessão ativa do usuário; senão resolve por prefixo.
   * Lança `SessionNotFoundError` se pediu a ativa e não há nenhuma.
   */
  async resolveOrActive(userId: number, idPrefix?: string): Promise<Session> {
    const trimmed = idPrefix?.trim();
    if (trimmed) return this.resolve(userId, trimmed);
    const active = await this.repo.findActiveByUser(userId);
    if (!active) throw new SessionNotFoundError('(sessão ativa)');
    return active;
  }

  /** Ativa a sessão (arquiva as demais ativas do usuário — invariante do repo). */
  async activate(userId: number, idPrefix: string): Promise<Session> {
    const target = await this.resolve(userId, idPrefix);
    const updated = await this.repo.activate(target.id, userId);
    if (!updated) throw new Error(`Não consegui ativar a sessão "${target.name}".`);
    return updated;
  }

  /** Muda o status (pause/archive). Sem regra de unicidade. */
  async setStatus(userId: number, idPrefix: string, status: SessionStatus): Promise<Session> {
    const target = await this.resolve(userId, idPrefix);
    await this.repo.setStatus(target.id, status);
    return { ...target, status };
  }

  /** Substitui o `config` JSONB de uma sessão (passthrough do repo). */
  updateConfig(sessionId: string, config: EnvironmentConfig): Promise<void> {
    return this.repo.updateConfig(sessionId, config);
  }

  /** Remove a sessão (logs/atividades/dependency_events caem por CASCADE). */
  async delete(userId: number, idPrefix: string): Promise<Session> {
    const target = await this.resolve(userId, idPrefix);
    await this.repo.delete(target.id);
    return target;
  }

  /**
   * Cria a sessão (o repo arquiva as outras ativas do usuário) e materializa o
   * ambiente do perfil, persistindo em `sessions.config`. Se a criação falha,
   * **lança** (o chamador aborta). Se só a materialização falha, devolve a
   * sessão com `materializeError` preenchido — não perde a sessão criada.
   */
  async create(input: CreateSessionInput): Promise<MaterializedSession> {
    const session = await this.repo.create({
      userId: input.userId,
      name: input.name,
      profile: input.profile,
      projectPath: input.projectPath,
      ide: input.ide,
    });
    return this.materializeInto(session, input.recipe);
  }

  /**
   * Re-materializa o ambiente de uma sessão existente (ativa ou por prefixo) e
   * persiste. Reaplica a recipe registrada em `config.extra.recipe` (relendo do
   * repo — pega mudanças). Diferente de `create`: a sessão já existe, então a
   * falha da materialização **propaga** (não há nada pra "não perder").
   */
  async materialize(userId: number, idPrefix?: string): Promise<MaterializedSession> {
    const session = await this.resolveOrActive(userId, idPrefix);
    const env = await this.builder.build(session.profile, this.recipeFor(session));
    await this.repo.updateConfig(session.id, env.config);
    return {
      session: { ...session, config: env.config },
      config: env.config,
      mcps: env.mcps,
      toolchains: env.toolchains,
      recipeWarnings: env.recipeWarnings,
    };
  }

  /** Recipe registrada no `config.extra.recipe` da sessão, relida do catálogo. */
  private recipeFor(session: Session): EnvironmentRecipe | undefined {
    const slug = (session.config.extra as { recipe?: string } | undefined)?.recipe;
    return slug ? (this.recipes.get(slug) ?? undefined) : undefined;
  }

  /** Materialização best-effort sobre uma sessão recém-criada. */
  private async materializeInto(
    session: Session,
    recipe?: EnvironmentRecipe,
  ): Promise<MaterializedSession> {
    try {
      const env = await this.builder.build(session.profile, recipe);
      await this.repo.updateConfig(session.id, env.config);
      return {
        session: { ...session, config: env.config },
        config: env.config,
        mcps: env.mcps,
        toolchains: env.toolchains,
        recipeWarnings: env.recipeWarnings,
      };
    } catch (err) {
      return {
        session,
        config: session.config,
        mcps: [],
        toolchains: [],
        recipeWarnings: [],
        materializeError: (err as Error).message,
      };
    }
  }
}
