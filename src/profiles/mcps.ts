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

/**
 * True se as 3 credenciais de service principal do Azure estão no ambiente. O MCP
 * (Azure Identity SDK) e o adapter REST do Fabric leem exatamente estes nomes.
 */
export function hasFabricServicePrincipal(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.AZURE_TENANT_ID && env.AZURE_CLIENT_ID && env.AZURE_CLIENT_SECRET);
}

/**
 * O usuário declarou que a conexão do Power BI é **local** (Desktop/`.pbix` aberto
 * nesta máquina)? Vem da flag `nio ai --local` (que seta `NIO_PBI_LOCAL`) ou do env
 * direto. Sem essa declaração explícita o `powerbi-modeling` **não sobe** — ele só
 * serve o caminho local. Exportado pra a TUI confirmar o modo ao subir.
 */
export function localPowerBiDeclared(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NIO_PBI_LOCAL === '1' || env.NIO_PBI_LOCAL === 'true';
}

/** Credenciais de service principal que o SDK Azure do MCP da Microsoft lê do env. */
const AZURE_SP_VARS = ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET'] as const;

/**
 * **Isola** o processo do `powerbi-modeling` das credenciais de service principal:
 * zera os `AZURE_*` **só no environment dele** (o opencode mescla env, então `''`
 * sobrescreve o herdado sem tirar PATH/HOME). Sem enxergar o SP, o MCP conecta no
 * **Power BI Desktop/`.pbix` local** em vez de tentar o Fabric XMLA. O processo do
 * nio (que faz o Fabric REST) mantém os `AZURE_*` intactos — os dois não se cruzam.
 */
function isolateFromServicePrincipal(spec: McpSpec): McpSpec {
  const environment = { ...spec.environment };
  for (const v of AZURE_SP_VARS) environment[v] = '';
  return { ...spec, environment };
}

/**
 * Adapter de caminhos do Power BI — dois adapters isolados, um por destino:
 * - **Local (`.pbix`/Desktop) → `powerbi-modeling` (XMLA local)**: sempre presente.
 *   Com SP no ambiente, seu processo é **isolado dos `AZURE_*`** (`isolateFrom...`)
 *   pra não drenar pro Fabric — o MCP da Microsoft, vendo o SP no env, iria pro
 *   Fabric XMLA sozinho (timeout/`Failed to connect to TOM` em PPU/SP).
 *
 * Regra: o `powerbi-modeling` serve **só a conexão local**, e só entra quando o usuário
 * **declara** isso com `NIO_PBI_LOCAL=1`.
 *
 * - **Sem declaração (default)** → `powerbi-modeling` **não sobe**. O Power BI é acessado
 *   pela nuvem, via REST (`nio_fabric_*`), que não precisa de XMLA nem de licença.
 * - **Com `NIO_PBI_LOCAL=1`** → sobe em modo Desktop-local. Se houver service principal
 *   no ambiente, o processo dele é **isolado dos `AZURE_*`**: sem isso o MCP da Microsoft
 *   enxerga o SP e vai tentar o Fabric XMLA em vez do modelo local.
 *
 * Os dois caminhos nunca se cruzam: processos distintos, environments distintos.
 */
export function resolveFabricMcps(specs: McpSpec[], env: NodeJS.ProcessEnv = process.env): McpSpec[] {
  // Conexão local não declarada → o MCP de modelagem não tem o que fazer aqui.
  if (!localPowerBiDeclared(env)) return specs.filter((s) => s.id !== powerbiMcp.id);
  // Declarada, mas com SP no ambiente: isola, senão ele drena pro Fabric.
  if (!hasFabricServicePrincipal(env)) return specs;
  return specs.map((s) => (s.id === powerbiMcp.id ? isolateFromServicePrincipal(s) : s));
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
