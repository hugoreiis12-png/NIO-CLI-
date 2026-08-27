import { z } from 'zod';
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext } from './index.js';
import { jsonResult, errorResult } from '../lib/tool-result.js';
import { SessionManager } from '../app/session-manager.js';
import { sessionView, sessionErrorResult } from './session-shared.js';
import { brand } from '../brand.js';

const ArgsSchema = z.object({ id: z.string().min(1) }).strict();

export const definition: Tool = {
  name: `${brand.cliToolPrefix}session_activate`,
  description:
    'Ativa uma sessão de ambiente do usuário por id (o prefixo do UUID basta). Arquiva as ' +
    'demais sessões ativas do usuário — invariante: 1 sessão ativa por vez. Devolve a sessão ativada.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Id da sessão a ativar — o prefixo do UUID basta.' },
    },
    required: ['id'],
    additionalProperties: false,
  },
};

/** Núcleo testável — manager + userId já resolvidos. */
export async function runSessionActivate(
  manager: SessionManager,
  userId: number,
  id: string,
): Promise<CallToolResult> {
  try {
    const session = await manager.activate(userId, id);
    return jsonResult({ activated: sessionView(session) });
  } catch (err) {
    return sessionErrorResult(err);
  }
}

export async function handler(args: unknown, ctx: ToolContext): Promise<CallToolResult> {
  const parsed = ArgsSchema.safeParse(args);
  if (!parsed.success) return errorResult(`Argumento inválido: ${parsed.error.message}`);
  return runSessionActivate(new SessionManager(), ctx.user.id, parsed.data.id);
}
