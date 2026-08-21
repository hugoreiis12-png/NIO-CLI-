import { z } from 'zod';
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext } from './index.js';
import { jsonResult, errorResult } from '../lib/tool-result.js';
import { getJob } from '../lib/exec-delegate.js';
import { brand } from '../brand.js';

const ArgsSchema = z.object({ job_id: z.string().min(1) }).strict();

export const definition: Tool = {
  name: `${brand.cliToolPrefix}exec_status`,
  description:
    `Estado de uma execução delegada (\`${brand.cliToolPrefix}delegate_exec\`): running | done | failed, com o ` +
    'resumo do agente, os arquivos alterados e os checks determinísticos (tamanho, lint, build, ' +
    'testes). Use os checks como FATOS na sua revisão — não gaste ciclo revisando o mecânico.',
  inputSchema: {
    type: 'object',
    properties: {
      job_id: { type: 'string', description: `Id devolvido por \`${brand.cliToolPrefix}delegate_exec\`.` },
    },
    required: ['job_id'],
    additionalProperties: false,
  },
};

export async function handler(args: unknown, _ctx: ToolContext): Promise<CallToolResult> {
  const parsed = ArgsSchema.safeParse(args);
  if (!parsed.success) {
    return errorResult(`Argumento inválido: ${parsed.error.message}`);
  }

  const job = getJob(parsed.data.job_id);
  if (!job) return errorResult(`Job não encontrado: ${parsed.data.job_id}`);

  const failing = Object.entries(job.checks)
    .filter(([, c]) => !c.ok)
    .map(([name]) => name);

  return jsonResult({
    id: job.id,
    state: job.state,
    worktree: job.worktree,
    exit_code: job.exitCode,
    changed: job.changed,
    checks: job.checks,
    failing_checks: failing,
    summary: job.summary,
    error: job.error,
  });
}
