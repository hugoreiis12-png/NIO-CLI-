// Tool `nio_env_materialize` — re-materializa o ambiente de uma sessão existente.
import { z } from 'zod';
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext } from './index.js';
import { jsonResult, errorResult } from '../lib/tool-result.js';
import { SessionManager } from '../app/session-manager.js';
import { sessionView, sessionErrorResult, failedToolchains } from './session-shared.js';
import { brand } from '../brand.js';

const ArgsSchema = z.object({ session: z.string().min(1).optional() }).strict();

export const definition: Tool = {
  name: `${brand.cliToolPrefix}env_materialize`,
  description:
    'Re-materializa o ambiente de uma sessão existente a partir do seu perfil: garante os ' +
    'toolchains de novo, re-resolve os MCPs e reescreve o `config` em `sessions.config`. Sem ' +
    '`session` usa a sessão ativa. Útil depois de mudar o catálogo de perfis ou pra recuperar ' +
    'um `config` incompleto. NÃO escreve o `opencode.json`.',
  inputSchema: {
    type: 'object',
    properties: {
      session: { type: 'string', description: 'Id da sessão (prefixo do UUID basta). Omita para a sessão ativa.' },
    },
    required: [],
    additionalProperties: false,
  },
};

/** Núcleo testável. */
export async function runEnvMaterialize(
  manager: SessionManager,
  userId: number,
  session?: string,
): Promise<CallToolResult> {
  try {
    const built = await manager.materialize(userId, session);
    return jsonResult({
      session: sessionView(built.session),
      config: built.config,
      mcps: built.mcps,
      toolchains_failed: failedToolchains(built.toolchains),
      recipe_warnings: built.recipeWarnings,
    });
  } catch (err) {
    return sessionErrorResult(err, 'materializar o ambiente');
  }
}

export async function handler(args: unknown, ctx: ToolContext): Promise<CallToolResult> {
  const parsed = ArgsSchema.safeParse(args);
  if (!parsed.success) return errorResult(`Argumento inválido: ${parsed.error.message}`);
  return runEnvMaterialize(new SessionManager(), ctx.user.id, parsed.data.session);
}
