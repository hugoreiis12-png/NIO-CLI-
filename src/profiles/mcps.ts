/**
 * MCPs reutilizados por mais de um perfil. Só entram aqui specs com comando
 * verificável — MCP sem launch conhecido fica como TODO no perfil, não como
 * entrada fictícia (que geraria um `opencode.json` quebrado).
 */
import type { McpSpec } from '../core/environment.js';
import { DOCKER_MCP_URL } from '../lib/docker/config.js';

/**
 * `nio-lang` — MCP server nativo da CLI que centraliza conhecimento/config das
 * linguagens (Python/TS/Node/C#/n8n). É **base de TODO perfil** (entra no
 * `BASE_MCPS` do `EnvironmentBuilder`), no lugar que o context7 ocupava. Roda
 * como binário local da própria CLI. Ver `docs/arch/ARQUITETURA-NIO-LANG.md`.
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
 * **Perfis analytics** (`analyst`, `bi`, `scientist`, `dba`). Comando oficial
 * portável (github.com/microsoft/powerbi-modeling-mcp) — a spec canônica do NIO
 * (npx @microsoft), que evita o registro duplicado da extensão do VS Code.
 * `npx -y @microsoft/powerbi-modeling-mcp@latest --start [--skipconfirmation]`.
 * Sem auth para conexão com o Power BI Desktop — basta o modelo aberto no Desktop
 * (auth por env só é necessária p/ service principal/Fabric). `--skipconfirmation`
 * auto-aprova as operações (mesma config que o dono do projeto já usa).
 */
export const powerbiMcp: McpSpec = {
  id: 'powerbi-modeling',
  command: ['npx', '-y', '@microsoft/powerbi-modeling-mcp@latest', '--start', '--skipconfirmation'],
};

/** Flag que força o MCP a autenticar por service principal (headless, contra Fabric). */
const SERVICE_PRINCIPAL_FLAG = '--authmode=serviceprincipal';

/**
 * True se as 3 credenciais de service principal do Azure estão no ambiente. O MCP
 * (Azure Identity SDK) e o adapter REST do Fabric leem exatamente estes nomes.
 */
export function hasFabricServicePrincipal(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.AZURE_TENANT_ID && env.AZURE_CLIENT_ID && env.AZURE_CLIENT_SECRET);
}

/**
 * Resolve a spec do PowerBI conforme o ambiente: com service principal configurado,
 * anexa `--authmode=serviceprincipal` (conecta ao XMLA do Fabric sem login interativo);
 * sem SP, mantém o comando Desktop-local (sem auth, modelo aberto na máquina). Só afeta
 * o `powerbiMcp`; idempotente. Os segredos `AZURE_*` são lidos do env herdado pelo MCP,
 * nunca escritos no `opencode.json`.
 */
export function withFabricAuth(spec: McpSpec, env: NodeJS.ProcessEnv = process.env): McpSpec {
  if (spec.id !== powerbiMcp.id || !hasFabricServicePrincipal(env)) return spec;
  if (spec.command?.includes(SERVICE_PRINCIPAL_FLAG)) return spec;
  return { ...spec, command: [...(spec.command ?? []), SERVICE_PRINCIPAL_FLAG] };
}

/** Opt-in (`NIO_FABRIC_XMLA=1`) pra reabilitar a modelagem XMLA por service principal. */
function xmlaOptIn(env: NodeJS.ProcessEnv): boolean {
  return env.NIO_FABRIC_XMLA === '1' || env.NIO_FABRIC_XMLA === 'true';
}

/**
 * Adaptividade dos dois caminhos do Power BI, na MESMA config:
 * - **REST → consulta no Fabric**: as tools `nio_fabric_*` (servidor MCP do nio)
 *   consultam datasets do Fabric por service principal, sem XMLA. Sempre presentes.
 * - **XMLA → modelagem no Desktop local**: o MCP `powerbi-modeling` conecta no modelo
 *   aberto no Power BI Desktop (XMLA local, sem auth). Fica **sempre presente** neste
 *   modo — é o default aqui (sem `--authmode`).
 *
 * O modo Fabric-XMLA por service principal (`--authmode=serviceprincipal`) NÃO entra
 * por padrão: exige capacidade Premium **dedicada** (SKU P/F) com a SP licenciada —
 * PPU e workspace compartilhado não valem pra SP (`PowerBINotLicensedException`).
 * Só é ligado com opt-in `NIO_FABRIC_XMLA=1`, pra quem tem capacidade dedicada.
 */
export function resolveFabricMcps(specs: McpSpec[], env: NodeJS.ProcessEnv = process.env): McpSpec[] {
  if (xmlaOptIn(env)) return specs.map((s) => withFabricAuth(s, env));
  return specs; // powerbi-modeling segue em Desktop-local; Fabric via REST (nio_fabric_*)
}

/**
 * Excel MCP (haris-musa/excel-mcp-server) — ler/escrever planilhas `.xlsx` sem
 * Excel instalado. **Perfis analytics** (`analyst`, `bi`, `scientist`, `dba`).
 * Roda via `uvx` (uv/Python) — pré-requisito de host; se `uv` faltar, o MCP não
 * sobe. Forma canônica que o global do usuário já usava: `uvx excel-mcp-server stdio`.
 * Modelado aqui (fonte única) e semeado no global via `installOpencodeGlobal`; os
 * perfis também o herdam por id (`inheritGlobalMcpIds`), então a def do usuário no
 * global, se houver, vence a modelada (cópia verbatim em `buildNioOpencodeConfig`).
 */
export const excelMcp: McpSpec = {
  id: 'excel',
  command: ['uvx', 'excel-mcp-server', 'stdio'],
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
 * opt-in via `nio docker toolkit up`. Ver `docs/arch/ARQUITETURA-DOCKER.md`.
 */
export const dockerGatewayMcp: McpSpec = {
  id: 'docker',
  url: DOCKER_MCP_URL,
};
