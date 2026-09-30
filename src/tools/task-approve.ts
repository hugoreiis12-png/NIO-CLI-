import { z } from 'zod';
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext } from './index.js';
import { jsonResult, errorResult } from '../lib/tool-result.js';
import { TaskManager } from '../app/task-manager.js';
import { brand } from '../brand.js';

const ArgsSchema = z.object({ task_id: z.string().min(1) }).strict();

export const definition: Tool = {
  name: `${brand.cliToolPrefix}task_approve`,
  description:
    'Libera a ferramenta que travou uma task em `waiting_approval` e devolve a task à fila; ' +
    'o worker retoma do passo que parou. Aprova **apenas** a ferramenta que a task está ' +
    'esperando, por nome exato — não concede permissão ampla nem afeta outras tasks. ' +
    'Falha se a task não estiver esperando aprovação, ou se ela parou numa pergunta do motor ' +
    '(pergunta precisa de resposta, não de permissão).',
  inputSchema: {
    type: 'object',
    properties: {
      task_id: { type: 'string', description: 'Id da task (aceita prefixo, como na CLI).' },
    },
    required: ['task_id'],
    additionalProperties: false,
  },
};

export async function handler(args: unknown, ctx: ToolContext): Promise<CallToolResult> {
  const parsed = ArgsSchema.safeParse(args);
  if (!parsed.success) {
    return errorResult(`Argumento inválido: ${parsed.error.message}`);
  }
  try {
    const task = await new TaskManager().approve(ctx.user.id, parsed.data.task_id);
    return jsonResult({
      id: task.id,
      status: task.status,
      liberado: task.approvedTools[task.approvedTools.length - 1] ?? null,
      approved_tools: task.approvedTools,
    });
  } catch (err) {
    // Erros do manager já são mensagens de usuário (prefixo ambíguo, task que
    // não espera nada, trava por pergunta) — repassar é melhor que reembrulhar.
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}
