import { z } from 'zod';
import { existsSync } from 'node:fs';
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext } from './index.js';
import { jsonResult, errorResult } from '../lib/tool-result.js';
import { startExec } from '../lib/exec/exec-delegate.js';
import { ENGINES, DEFAULT_ENGINE } from '../lib/exec/exec-engines.js';
import { brand } from '../brand.js';

const ArgsSchema = z
  .object({
    worktree: z.string().min(1),
    instruction: z.string().min(1),
    engine: z.enum(ENGINES).optional(),
  })
  .strict();

export const definition: Tool = {
  name: `${brand.cliToolPrefix}delegate_exec`,
  description:
    'Delega a IMPLEMENTAÇÃO a um agente de execução novo (codex ou claude local, na assinatura — sem API) ' +
    'num worktree já criado pelo /implement. Roda em background e, ao terminar, mede o resultado ' +
    '(tamanho de arquivo/função, lint, build, testes). NÃO julga qualidade e NÃO commita — o ' +
    `review fica com você (code-reviewer + harness). Consulte o resultado com \`${brand.cliToolPrefix}exec_status\`.`,
  inputSchema: {
    type: 'object',
    properties: {
      worktree: {
        type: 'string',
        description: 'Caminho absoluto do worktree onde implementar (criado pelo /implement).',
      },
      instruction: {
        type: 'string',
        description:
          'O que implementar: o ticket + critérios de aceitação. Numa re-tentativa, inclua as ' +
          'violações apontadas pelo review — o agente de execução é novo e não herda a conversa.',
      },
      engine: {
        type: 'string',
        enum: [...ENGINES],
        description: `Agente de execução a usar. Default: ${DEFAULT_ENGINE}.`,
      },
    },
    required: ['worktree', 'instruction'],
    additionalProperties: false,
  },
};

export async function handler(args: unknown, _ctx: ToolContext): Promise<CallToolResult> {
  const parsed = ArgsSchema.safeParse(args);
  if (!parsed.success) {
    return errorResult(`Argumento inválido: ${parsed.error.message}`);
  }
  const { worktree, instruction, engine } = parsed.data;
  if (!existsSync(worktree)) {
    return errorResult(`Worktree não encontrado: ${worktree}`);
  }

  const job = startExec({ worktree, instruction, engine });
  if (job.state === 'failed') {
    return errorResult(job.error ?? 'falha ao iniciar a execução');
  }

  return jsonResult({
    job_id: job.id,
    state: job.state,
    engine: job.engine,
    worktree: job.worktree,
    hint: `Consulte com \`${brand.cliToolPrefix}exec_status\` até state=done|failed.`,
  });
}
