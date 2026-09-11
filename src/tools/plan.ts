import { z } from 'zod';
import { existsSync } from 'node:fs';
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext } from './index.js';
import { jsonResult, errorResult } from '../lib/tool-result.js';
import { runPlan } from '../lib/exec/plan-delegate.js';
import { brand } from '../brand.js';

const ArgsSchema = z
  .object({
    project: z.string().min(1),
    instruction: z.string().min(1),
  })
  .strict();

export const definition: Tool = {
  name: `${brand.cliToolPrefix}plan`,
  description:
    'Roda o Qwen (vLLM local, via API) sobre a raiz do projeto e escreve/refina o `plan.md` de ' +
    'rascunho pré-SDD. NÃO implementa código, não cria worktree e não roda checks — pra isso use ' +
    `\`${brand.cliToolPrefix}delegate_exec\`. Se o \`plan.md\` não existe, semeia a partir de um template; ` +
    'se existe, refina o conteúdo atual.',
  inputSchema: {
    type: 'object',
    properties: {
      project: {
        type: 'string',
        description: 'Caminho absoluto da raiz do projeto onde vive o plan.md.',
      },
      instruction: {
        type: 'string',
        description: 'A ideia a rascunhar ou o ajuste a aplicar no plano atual.',
      },
    },
    required: ['project', 'instruction'],
    additionalProperties: false,
  },
};

export async function handler(args: unknown, _ctx: ToolContext): Promise<CallToolResult> {
  const parsed = ArgsSchema.safeParse(args);
  if (!parsed.success) {
    return errorResult(`Argumento inválido: ${parsed.error.message}`);
  }
  const { project, instruction } = parsed.data;
  if (!existsSync(project)) {
    return errorResult(`Projeto não encontrado: ${project}`);
  }

  const result = await runPlan({ project, instruction });
  if (!result.ok) {
    return errorResult(result.error ?? 'falha ao planejar');
  }

  return jsonResult({ ok: true, path: result.path, engine: result.engine });
}
