/**
 * Fonte única de "quais tools do MCP nativo do n8n só leem". Duas camadas consomem:
 * o `askTools` do spec (`mcps.ts`) e a allowlist do worker (`auto-approve.ts`).
 *
 * A política é **falha-fechado**: não enumeramos escrita, enumeramos leitura. Tool
 * que não está aqui — inclusive uma que o n8n lance amanhã — cai em aprovação.
 * Lista conferida na referência oficial de tools do MCP server do n8n.
 */

/** Id do server no `opencode.json` — o cliente nomeia a tool `<id>_<tool>`. */
export const N8N_NATIVE_ID = 'n8n-native';

/**
 * Somente leitura. `test_workflow` está **fora de propósito**: a doc o classifica como
 * leitura, mas ele executa os nodes sem pin data — efeito externo real.
 */
export const N8N_NATIVE_READ_TOOLS: readonly string[] = [
  // Workflow management
  'search_workflows',
  'get_workflow_details',
  'prepare_workflow_pin_data',
  'get_workflow_history',
  'get_workflow_version',
  'get_workflow_versions_diff',
  // Organização
  'search_projects',
  'search_folders',
  'list_workflow_tags',
  // Execuções
  'get_workflow_execution',
  'search_workflow_executions',
  // Credenciais (metadado; o segredo nunca volta)
  'list_credentials',
  // Contexto da instância
  'get_instance_context',
  'get_instance_activity',
  'expand_instance_activity',
  'get_node_usage',
  // Workflow builder — docs, descoberta e validação não salvam nada
  'get_workflow_sdk_reference',
  'search_nodes',
  'get_node_types',
  'get_workflow_best_practices',
  'explore_node_resources',
  'validate_workflow',
  'validate_node_config',
  // Agents (preview) — só leitura e validação
  'search_agents',
  'get_agent',
  'get_agent_builder_reference',
  'discover_agent_assets',
  'validate_agent',
  'verify_agent_mcp_server',
  'list_agent_versions',
  // Data tables
  'search_data_tables',
];

const READ_SET: ReadonlySet<string> = new Set(N8N_NATIVE_READ_TOOLS);

export function isN8nNativeReadTool(tool: string): boolean {
  return READ_SET.has(tool);
}

/** Nomes como o cliente/worker os vê: `n8n-native_<tool>`. */
export function prefixedN8nNativeReadTools(): string[] {
  return N8N_NATIVE_READ_TOOLS.map((tool) => `${N8N_NATIVE_ID}_${tool}`);
}
