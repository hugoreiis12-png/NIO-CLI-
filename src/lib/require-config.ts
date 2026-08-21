import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext } from '../tools/index.js';
import { UUID_REGEX } from '../config.js';
import { errorResult } from './tool-result.js';
import { loadActiveProjectId } from './active-project.js';
import { brand } from '../brand.js';

/**
 * Projeto já resolvido para uma chamada de tool — `project_id` sempre presente
 * (a resolução erra explicitamente quando não há nenhum). É mais estrito que o
 * `ProjectConfig` do arquivo, onde `project_id` é opcional (init local sem auth).
 */
export interface ResolvedProject {
  project_id: string;
  repository_id?: string | null;
}

/**
 * Resolve o projeto efetivo de uma chamada, na ordem:
 *   1. project_id explícito passado na tool (override por chamada)
 *   2. projeto ativo da sessão (`nos_set_project`, só em memória)
 *   3. default do ambiente/arquivo (NIO_PROJECT_ID / nio.json)
 *
 * O repository_id default só é aplicado quando o projeto resolvido é o mesmo do
 * default — evita herdar um repositório de outro projeto.
 */
export function resolveProjectConfig(
  ctx: ToolContext,
  explicitProjectId?: string,
): ResolvedProject | CallToolResult {
  const projectId = explicitProjectId ?? loadActiveProjectId() ?? ctx.config?.project_id;

  if (!projectId) {
    return errorResult(
      `Nenhum projeto selecionado. Use \`${brand.toolPrefix}list_projects\` para ver os seus e ` +
        `\`${brand.toolPrefix}set_project\` para escolher um (ou passe \`project_id\` direto na chamada).`,
    );
  }
  if (!UUID_REGEX.test(projectId)) {
    return errorResult(`project_id inválido (UUID esperado): ${projectId}`);
  }

  const config: ResolvedProject = { project_id: projectId };
  if (projectId === ctx.config?.project_id && ctx.config?.repository_id) {
    config.repository_id = ctx.config.repository_id;
  }
  return config;
}

export function isErrorResult(value: unknown): value is CallToolResult {
  return typeof value === 'object' && value !== null && 'isError' in value;
}
