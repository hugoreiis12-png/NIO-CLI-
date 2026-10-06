/**
 * MCPs de **infraestrutura do time** — os que valem para TODO perfil porque são
 * da rede, não da stack do projeto: os dois Postgres de leitura e os gateways
 * remotos de BI. Entram no `BASE_MCPS` do `EnvironmentBuilder`.
 *
 * Separado de `mcps.ts` (que modela MCP por stack/linguagem) por
 * responsabilidade: aqui o eixo é o host, lá é a linguagem.
 *
 * **Credencial não entra neste arquivo.** `environment` é gravado em texto puro
 * no `opencode.json` e este fonte é versionado — a URL completa (com usuário e
 * senha) vem de env var, e o host/porta/banco ficam documentados no comentário
 * de cada spec. Sem a env var o MCP é **omitido** em vez de subir apontando pra
 * lugar nenhum.
 */
import type { McpSpec } from '../core/environment.js';

/** Env var com a URL completa do Postgres legado (`192.168.0.250:5432/postgres`). */
export const PG_LEGACY_URL_ENV = 'NIO_PG_VELHA_URL';
/** Env var com a URL completa do Postgres atual (`192.168.0.142:5432/postgres`). */
export const PG_MAIN_URL_ENV = 'NIO_PG_NOVO_URL';

/** Base do endpoint dos gateways de BI remotos (`192.168.0.160:8011`). */
export const BI_GATEWAY_URL_ENV = 'NIO_BI_GATEWAY_MCP_URL';
const BI_GATEWAY_DEFAULT_URL = 'http://192.168.0.160:8011/mcp';

/** O driver é o mesmo nos dois Postgres — só a URL e o timeout mudam. */
const PG_MCP_COMMAND = ['npx', '--yes', 'pg-mcp-server', '--transport', 'stdio'];

/**
 * Somente leitura, sem exceção: `WRITE_OPERATIONS_ENABLED=false` é a razão de
 * estes MCPs poderem ser globais. Com escrita ligada, cada perfil precisaria de
 * `askTools` e o default `park` do worker viraria atrito em toda consulta.
 */
const PG_READ_ONLY = 'false';

/** Monta o spec de um Postgres de leitura. `null` se a env var não está no ambiente. */
function pgReadOnlyMcp(
  id: string,
  urlEnv: string,
  timeout: number,
  env: NodeJS.ProcessEnv,
): McpSpec | null {
  const url = env[urlEnv]?.trim();
  if (!url) return null;
  return {
    id,
    command: PG_MCP_COMMAND,
    environment: { DATABASE_URL: url, WRITE_OPERATIONS_ENABLED: PG_READ_ONLY },
    timeout,
  };
}

/**
 * Postgres **legado** (`192.168.0.250`), somente leitura. 10 s de timeout: é o
 * host que responde rápido ou não responde — esperar mais não melhora nada.
 */
export function pgLegacyMcp(env: NodeJS.ProcessEnv = process.env): McpSpec | null {
  return pgReadOnlyMcp('postgres-velha', PG_LEGACY_URL_ENV, 10_000, env);
}

/**
 * Postgres **atual** (`192.168.0.142`, o do ADR 0014), somente leitura. 30 s
 * porque é o banco com volume — uma query de inventário de schema passa de 10 s.
 */
export function pgMainMcp(env: NodeJS.ProcessEnv = process.env): McpSpec | null {
  return pgReadOnlyMcp('postgres-novo', PG_MAIN_URL_ENV, 30_000, env);
}

/** URL dos gateways remotos — override por env, default no host da LAN. */
function biGatewayUrl(env: NodeJS.ProcessEnv): string {
  return env[BI_GATEWAY_URL_ENV]?.trim() || BI_GATEWAY_DEFAULT_URL;
}

/**
 * `dax-staff-local` — gateway remoto de DAX. 120 s: a 1ª chamada aquece o modelo
 * do outro lado e o default do cliente corta antes disso.
 */
export function daxStaffMcp(env: NodeJS.ProcessEnv = process.env): McpSpec {
  return { id: 'dax-staff-local', url: biGatewayUrl(env), timeout: 120_000 };
}

/**
 * `bi-gateway-portainer` — mesmo endpoint do `dax-staff-local`, registrado como
 * server próprio porque é assim que o time já o referencia. Dois ids no mesmo
 * host significam **tools duplicadas** no cliente; ver o aviso em
 * `biGatewaysCollide`.
 */
export function biGatewayPortainerMcp(env: NodeJS.ProcessEnv = process.env): McpSpec {
  return { id: 'bi-gateway-portainer', url: biGatewayUrl(env), timeout: 120_000 };
}

/** `true` quando os dois gateways apontam pro mesmo endpoint (tools duplicadas). */
export function biGatewaysCollide(env: NodeJS.ProcessEnv = process.env): boolean {
  return daxStaffMcp(env).url === biGatewayPortainerMcp(env).url;
}

/**
 * Os MCPs de infra disponíveis neste ambiente, na ordem em que entram no config.
 * Os Postgres caem fora quando a env var da URL não está setada.
 */
export function infraMcps(env: NodeJS.ProcessEnv = process.env): McpSpec[] {
  const pg = [pgLegacyMcp(env), pgMainMcp(env)].filter((m): m is McpSpec => m !== null);
  return [...pg, daxStaffMcp(env), biGatewayPortainerMcp(env)];
}
