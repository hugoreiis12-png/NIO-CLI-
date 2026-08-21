import { UUID_REGEX } from '../config.js';

/**
 * Projeto ativo da sessão, mantido **só em memória** pelo tempo de vida do
 * processo do MCP server. Não persiste em disco: ao reiniciar o servidor o
 * projeto volta ao default (nio.json/env), e nada vaza entre máquinas ou
 * outros clientes.
 *
 * Caveat: no Claude Desktop/Cowork um único processo do servidor pode ser
 * compartilhado entre conversas, então o ativo é por processo, não estritamente
 * por conversa. O argumento `project_id` por chamada continua sendo o override
 * por-conversa (ver `resolveProjectConfig`).
 */
let activeProjectId: string | null = null;

/** Projeto ativo da sessão, ou null se nenhum/UUID inválido. */
export function loadActiveProjectId(): string | null {
  return activeProjectId !== null && UUID_REGEX.test(activeProjectId)
    ? activeProjectId
    : null;
}

/** Define o projeto ativo da sessão (em memória). */
export function setActiveProjectId(projectId: string): void {
  activeProjectId = projectId;
}

/** Limpa o projeto ativo da sessão. */
export function clearActiveProjectId(): void {
  activeProjectId = null;
}
