import { z } from 'zod';
import { existsSync } from 'node:fs';
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext } from './index.js';
import { jsonResult, errorResult } from '../lib/tool-result.js';
import { runValidatePlan } from '../lib/exec/validate-plan-delegate.js';
import { brand } from '../brand.js';

const ArgsSchema = z
  .object({
    project: z.string().min(1),
  })
  .strict();

export const definition: Tool = {
  name: `${brand.cliToolPrefix}validate_plan`,
  description:
    'Lê o `plan.md` da raiz do projeto e roda o Qwen (vLLM local, via API) para julgar se o plano ' +
    'é complexo o bastante para virar uma spec SDD antes de implementar. Devolve { needsSpec, reason, ' +
    'suggestedSlug? } — é triagem, NÃO gera spec nem código. suggestedSlug (slug git-safe p/ nomear o ' +
    `worktree) só sai quando needsSpec. Requer um \`plan.md\` (rode \`${brand.cliToolPrefix}plan\` antes).`,
  inputSchema: {
    type: 'object',
    properties: {
      project: {
        type: 'string',
        description: 'Caminho absoluto da raiz do projeto onde vive o plan.md.',
      },
    },
    required: ['project'],
    additionalProperties: false,
  },
};

export async function handler(args: unknown, _ctx: ToolContext): Promise<CallToolResult> {
  const parsed = ArgsSchema.safeParse(args);
  if (!parsed.success) {
    return errorResult(`Argumento inválido: ${parsed.error.message}`);
  }
  const { project } = parsed.data;
  if (!existsSync(project)) {
    return errorResult(`Projeto não encontrado: ${project}`);
  }

  const result = await runValidatePlan({ project });
  if (!result.ok) {
    return errorResult(result.error ?? 'falha ao validar o plano');
  }

  return jsonResult({
    ok: true,
    needsSpec: result.needsSpec,
    reason: result.reason,
    suggestedSlug: result.suggestedSlug,
    engine: result.engine,
  });
}
