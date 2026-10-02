/**
 * Allowlists de auto-aprovação do `nio-worker` — o dado por trás do
 * human-in-the-loop (`ProfileDefinition.autoApprove`).
 *
 * Princípio: **auto-aprova o que lê, pede aprovação para o que muda o mundo.**
 * Um step roda sem ninguém olhando, e conteúdo analisado (um `.pdf` de contrato,
 * uma página buscada) pode carregar instrução hostil. Ler de novo custa tokens;
 * escrever ou executar errado custa o repositório do usuário.
 *
 * Fora da allowlist ≠ proibido: a task dorme em `waiting_approval` e o usuário
 * libera com `nio task approve`. O default é caro em latência, não em segurança.
 */
import { prefixedN8nNativeReadTools } from './n8n-native-tools.js';

/**
 * Leitura pura, igual em todo perfil. Nomes de tool nativas do motor (opencode).
 * `webfetch` está **de fora** de propósito: traz texto de terceiro para dentro do
 * contexto, que é exatamente a porta de entrada de prompt injection.
 */
const ENGINE_READ_ONLY = ['read', 'grep', 'glob', 'list', 'todoread', 'todowrite'];

/** Tools `nio_` que só consultam estado local — sem efeito no ambiente. */
const NIO_READ_ONLY = [
  'nio_profile_get',
  'nio_session_list',
  'nio_env_detect_deps',
  'nio_exec_status',
  'nio_validate_plan',
];

/**
 * Consulta ao Fabric/Power BI. Executa DAX, que é leitura — o `executeQueries`
 * da API não escreve no modelo semântico. `nio_fabric_schema_sync` fica de fora:
 * ingere no acervo vetorial, ou seja, escreve.
 */
const FABRIC_READ_ONLY = [
  'nio_fabric_ask',
  'nio_fabric_query',
  'nio_fabric_measure',
  'nio_fabric_workspaces',
  'nio_fabric_datasets',
  'nio_pbi_local',
];

/**
 * n8n: a tool REST de leitura e as tools de leitura do MCP nativo. Lista explícita, não
 * curinga — `n8n-native_get_*` casaria com tool futura desconhecida, e o ponto da
 * política falha-fechado é justamente que o desconhecido estacione.
 *
 * Assimetria consciente com o `webfetch` acima: conteúdo de workflow e de execução
 * também é texto de terceiro. Entra porque ler o workflow é o trabalho do perfil, e o
 * que ele faz depois com isso (escrever, executar) continua pedindo aprovação.
 */
const N8N_READ_ONLY = ['nio_lang_n8n', ...prefixedN8nNativeReadTools()];

/** Base comum: todo perfil lê arquivo e consulta o próprio estado. */
export const BASE_AUTO_APPROVE: string[] = [...ENGINE_READ_ONLY, ...NIO_READ_ONLY];

/** Base + o domínio analítico (perfis `bi` e `analyst`). */
export const ANALYTICS_AUTO_APPROVE: string[] = [...BASE_AUTO_APPROVE, ...FABRIC_READ_ONLY];

/** Base + n8n (perfil `fullstack`, o único que registra os MCPs de n8n). */
export const FULLSTACK_AUTO_APPROVE: string[] = [...BASE_AUTO_APPROVE, ...N8N_READ_ONLY];
