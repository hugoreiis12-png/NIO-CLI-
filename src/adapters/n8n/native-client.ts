/**
 * Cliente do MCP **nativo** do n8n (Settings > Instance-level MCP). Serve a um único
 * propósito: descobrir quais tools aquela instância expõe, para que
 * `buildN8nNativeMcp` possa marcar `ask` em tudo que não for leitura conhecida.
 *
 * Usa o `Client` do SDK MCP em vez de JSON-RPC na mão: o handshake `initialize`,
 * o `Mcp-Session-Id`, o parsing de SSE e o `MCP-Protocol-Version` são dele.
 * `fetch` é injetável porque o teste nunca mocka global.
 *
 * O token nunca entra em mensagem de erro.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { brand } from '../../brand.js';
import { isTransportTrusted, PLAIN_HTTP_HINT } from '../../lib/url-trust.js';
import { VERSION } from '../../version.js';

const MCP_PATH = '/mcp-server/http';
const TIMEOUT_MS = 20_000;
const MAX_PAGES = 20;

export interface N8nNativeDeps {
  fetch?: typeof fetch;
}

export interface N8nNativeDetection {
  ok: boolean;
  /** Nome/versão que o servidor reporta no `initialize` — a versão da instância sai de graça. */
  serverVersion?: string;
  tools?: string[];
  error?: string;
}

/**
 * Aceita a URL da instância com ou sem o sufixo `/mcp-server/http` e devolve a
 * canônica. String de erro (não exceção) quando a URL não serve.
 */
export function normalizeNativeUrl(raw: string): string | { error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { error: 'URL vazia.' };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { error: `URL inválida: "${trimmed.slice(0, 40)}".` };
  }
  if (!isTransportTrusted(url)) {
    return { error: `a URL precisa ser https — ${PLAIN_HTTP_HINT}.` };
  }
  const root = url.href.replace(/\/+$/, '').replace(new RegExp(`${MCP_PATH}$`), '');
  return `${root}${MCP_PATH}`;
}

/** Puxa todas as páginas de `tools/list`. O servidor pagina quando tem muitas tools. */
async function listAllToolNames(client: Client): Promise<string[]> {
  const names: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const res = await client.listTools(cursor ? { cursor } : undefined);
    for (const tool of res.tools) names.push(tool.name);
    const next = res.nextCursor;
    if (typeof next !== 'string' || next === '') return names;
    cursor = next;
  }
  return names;
}

/**
 * Mensagem acionável a partir do status HTTP. O `StreamableHTTPError` do SDK não põe o
 * código no texto, só no campo `code` — por isso lemos o campo, não a mensagem.
 * O token é redigido porque o erro pode embutir o header.
 */
function describeFailure(err: unknown, token: string): string {
  const status = err instanceof StreamableHTTPError ? err.code : undefined;
  if (status === 401) {
    return 'o n8n recusou o token (401) — confira se ele é do Instance-level MCP e não expirou.';
  }
  if (status === 403) return 'o token não tem permissão no MCP da instância (403).';
  if (status === 404) {
    return 'endpoint não encontrado (404) — o MCP da instância pode estar desabilitado em Settings.';
  }
  const raw = err instanceof Error ? err.message : String(err);
  const message = token ? raw.split(token).join('***') : raw;
  return `falha ao falar com o MCP do n8n: ${message}`;
}

/**
 * Conecta, lista as tools e desconecta. `tools` vazio é tratado como falha: um token
 * sem escopo devolveria lista vazia, e tratar isso como "nada a liberar" inverteria
 * a política falha-fechado em silêncio.
 */
export async function detectNativeTools(
  rawUrl: string,
  token: string,
  deps: N8nNativeDeps = {},
): Promise<N8nNativeDetection> {
  const url = normalizeNativeUrl(rawUrl);
  if (typeof url !== 'string') return { ok: false, error: url.error };
  const secret = token.trim();
  if (!secret) return { ok: false, error: 'token vazio.' };

  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${secret}` } },
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  });
  const client = new Client({ name: brand.name, version: VERSION });

  try {
    await client.connect(transport, { timeout: TIMEOUT_MS });
    const tools = await listAllToolNames(client);
    if (tools.length === 0) {
      return { ok: false, error: 'o servidor não expôs nenhuma tool — token sem escopo?' };
    }
    const info = client.getServerVersion();
    return {
      ok: true,
      tools,
      ...(info ? { serverVersion: `${info.name} ${info.version}` } : {}),
    };
  } catch (err) {
    return { ok: false, error: describeFailure(err, secret) };
  } finally {
    await client.close().catch(() => {});
  }
}
