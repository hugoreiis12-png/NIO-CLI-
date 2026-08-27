import { z } from 'zod';
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext } from './index.js';
import { jsonResult, errorResult } from '../lib/tool-result.js';
import { SessionManager } from '../app/session-manager.js';
import { sessionView, sessionErrorResult } from './session-shared.js';
import { brand } from '../brand.js';

const ArgsSchema = z.object({}).strict();

export const definition: Tool = {
  name: `${brand.cliToolPrefix}session_list`,
  description:
    'Lista as sessões de ambiente do usuário autenticado (mais recentes primeiro), com id, ' +
    'nome, perfil, status e o `config` materializado. A sessão de status `active` é o alvo ' +
    'default das tools de ambiente. Read-only.',
  inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
};

/** Núcleo testável — recebe o manager e o id do usuário já resolvidos. */
export async function runSessionList(manager: SessionManager, userId: number): Promise<CallToolResult> {
  try {
    const sessions = await manager.list(userId);
    return jsonResult({ count: sessions.length, sessions: sessions.map(sessionView) });
  } catch (err) {
    return sessionErrorResult(err);
  }
}

export async function handler(args: unknown, ctx: ToolContext): Promise<CallToolResult> {
  const parsed = ArgsSchema.safeParse(args);
  if (!parsed.success) return errorResult(`Argumento inválido: ${parsed.error.message}`);
  return runSessionList(new SessionManager(), ctx.user.id);
}
