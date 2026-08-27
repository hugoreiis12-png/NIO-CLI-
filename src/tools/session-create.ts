// Tool `nio_session_create` — cria uma sessão de ambiente e materializa o perfil.
import { z } from 'zod';
import { existsSync } from 'node:fs';
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext } from './index.js';
import { jsonResult, errorResult } from '../lib/tool-result.js';
import { SessionManager, type CreateSessionInput } from '../app/session-manager.js';
import { createRecipeCatalog } from '../adapters/skills/recipe-catalog.js';
import { sessionView, sessionErrorResult, failedToolchains } from './session-shared.js';
import { brand } from '../brand.js';

const PROFILES = ['fullstack', 'analyst', 'scientist', 'dba', 'qa', 'bi'] as const;
const IDES = ['terminal', 'vscode', 'cursor', 'other'] as const;

const ArgsSchema = z
  .object({
    name: z.string().min(1),
    profile: z.enum(PROFILES),
    project_path: z.string().min(1),
    ide: z.enum(IDES).optional(),
    recipe: z.string().min(1).optional(),
  })
  .strict();

export const definition: Tool = {
  name: `${brand.cliToolPrefix}session_create`,
  description:
    'Cria uma sessão de ambiente pro usuário autenticado e materializa o perfil escolhido: ' +
    'garante os toolchains, resolve os MCPs e persiste o `config` em `sessions.config`. A nova ' +
    'sessão vira a `active` (as outras ativas do usuário são arquivadas). NÃO escreve o ' +
    '`opencode.json` nem inicia nenhum cliente — devolve os `mcps` como dado pra você registrar.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Nome da sessão (livre, ajuda a identificar depois).' },
      profile: { type: 'string', enum: [...PROFILES], description: 'Perfil de ambiente (ver `nio_profile_get`).' },
      project_path: { type: 'string', description: 'Caminho absoluto da pasta do projeto da sessão (deve existir).' },
      ide: { type: 'string', enum: [...IDES], description: 'Editor da sessão. Default: other.' },
      recipe: {
        type: 'string',
        description:
          'Slug de uma recipe do repo NIO-SKILLS (ver `recipes/`) a fundir sobre o perfil. Opcional.',
      },
    },
    required: ['name', 'profile', 'project_path'],
    additionalProperties: false,
  },
};

/** Núcleo testável — manager + userId já resolvidos. */
export async function runSessionCreate(
  manager: SessionManager,
  userId: number,
  input: Omit<CreateSessionInput, 'userId'>,
): Promise<CallToolResult> {
  try {
    const built = await manager.create({ userId, ...input });
    return jsonResult({
      session: sessionView(built.session),
      mcps: built.mcps,
      toolchains_failed: failedToolchains(built.toolchains),
      recipe_warnings: built.recipeWarnings,
      materialize_error: built.materializeError ?? null,
      note:
        'Os MCPs em `mcps` não foram escritos em nenhum cliente. Para o operador de IA ' +
        'enxergá-los, adicione-os ao `opencode.json` (ou equivalente) e reinicie o cliente.',
    });
  } catch (err) {
    return sessionErrorResult(err, 'criar a sessão');
  }
}

export async function handler(args: unknown, ctx: ToolContext): Promise<CallToolResult> {
  const parsed = ArgsSchema.safeParse(args);
  if (!parsed.success) return errorResult(`Argumento inválido: ${parsed.error.message}`);

  const { name, profile, project_path: projectPath, ide, recipe: recipeSlug } = parsed.data;
  if (!existsSync(projectPath)) {
    return errorResult(`Pasta do projeto não encontrada: ${projectPath}`);
  }

  let recipe;
  if (recipeSlug) {
    recipe = createRecipeCatalog().get(recipeSlug) ?? undefined;
    if (!recipe) return errorResult(`Recipe "${recipeSlug}" não encontrada (rode \`${brand.name} sync\`?).`);
    if (recipe.profile !== profile) {
      return errorResult(`Recipe "${recipeSlug}" é do perfil "${recipe.profile}", não "${profile}".`);
    }
  }

  return runSessionCreate(new SessionManager(), ctx.user.id, {
    name,
    profile,
    projectPath,
    ide: ide ?? 'other',
    recipe,
  });
}
