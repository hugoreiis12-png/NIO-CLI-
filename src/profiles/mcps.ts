/**
 * MCPs reutilizados por mais de um perfil. Só entram aqui specs com comando
 * verificável — MCP sem launch conhecido fica como TODO no perfil, não como
 * entrada fictícia (que geraria um `opencode.json` quebrado).
 */
import type { McpSpec } from '../core/environment.js';
import { DOCKER_MCP_URL } from '../lib/docker.js';

/**
 * `nio-lang` — MCP server nativo da CLI que centraliza conhecimento/config das
 * linguagens (Python/TS/Node/C#/n8n). É **base de TODO perfil** (entra no
 * `BASE_MCPS` do `EnvironmentBuilder`), no lugar que o context7 ocupava. Roda
 * como binário local da própria CLI. Ver `docs/v2/ARQUITETURA-NIO-LANG.md`.
 */
export const nioLangMcp: McpSpec = {
  id: 'nio-lang',
  command: ['nio-lang'],
};

/**
 * Servidor MCP de Postgres (reference server). A string de conexão é segredo por
 * ambiente — declaramos o env var, o valor é do host/usuário, não do `nio init`
 * (questão de auth em aberto, ver doc de arquitetura).
 */
export const postgresMcp: McpSpec = {
  id: 'postgres',
  command: ['npx', '-y', '@modelcontextprotocol/server-postgres'],
  environment: { DATABASE_URL: '' },
};

/**
 * PowerBI Modeling MCP (Microsoft) — modelagem/consulta de PowerBI (DAX, tabular).
 * **Exclusivo dos perfis `analyst` e `bi`** (só faz sentido pra quem trabalha com
 * BI). Comando oficial portável (github.com/microsoft/powerbi-modeling-mcp):
 * `npx -y @microsoft/powerbi-modeling-mcp@latest --start [--skipconfirmation]`.
 * Sem auth para conexão com o Power BI Desktop — basta o modelo aberto no Desktop
 * (auth por env só é necessária p/ service principal/Fabric). `--skipconfirmation`
 * auto-aprova as operações (mesma config que o dono do projeto já usa).
 */
export const powerbiMcp: McpSpec = {
  id: 'powerbi-modeling',
  command: ['npx', '-y', '@microsoft/powerbi-modeling-mcp@latest', '--start', '--skipconfirmation'],
};

/**
 * n8n-mcp (czlonkowski) — MCP server de n8n (docs de nodes/workflows). Registrado
 * como MCP **próprio** (é server de verdade, não dobra no `nio-lang`) quando o
 * usuário escolhe a linguagem `n8n` no wizard fullstack. Roda **sem auth** para
 * as tools de documentação; `N8N_API_URL`/`N8N_API_KEY` (opcionais) habilitam as
 * de gerenciar workflow ao vivo. Pacote npm verificado: `n8n-mcp` (bin stdio).
 */
export const n8nMcp: McpSpec = {
  id: 'n8n',
  command: ['npx', '-y', 'n8n-mcp'],
};

/**
 * Docker MCP Gateway — MCP **remoto** (container `nio-mcp-gateway` do
 * `docker/docker-compose.yml`, server `docker` do catálogo). Fora do `BASE_MCPS`:
 * opt-in via `nio docker toolkit up`. Ver `docs/v2/ARQUITETURA-DOCKER.md`.
 */
export const dockerGatewayMcp: McpSpec = {
  id: 'docker',
  url: DOCKER_MCP_URL,
};
