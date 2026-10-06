/**
 * Tools `nio_lang_n8n` (leitura) e `nio_lang_n8n_write` (ativar/desativar) do server
 * `nio-lang` — falam com a API pública REST do n8n (`/api/v1`, header `X-N8N-API-KEY`).
 *
 * Duas tools, não uma: a de escrita é a única marcada `ask` no config do opencode
 * (`McpSpec.askTools`), então ler nunca pede aprovação e mudar estado sempre pede.
 * A API pública não tem endpoint de "executar workflow" — por isso não há ação `run`.
 *
 * Credenciais só do env (`N8N_API_URL`, `N8N_API_KEY`); a chave nunca entra em
 * mensagem de erro. Handlers puros: `fetch` e env injetáveis pra teste.
 *
 * O protocolo da URL é decidido por `lib/url-trust`: https sempre, http só em
 * localhost ou IP de rede privada (instância self-hosted na LAN).
 */
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { jsonResult, errorResult } from '../lib/tool-result.js';
import { isTransportTrusted, PLAIN_HTTP_HINT } from '../lib/url-trust.js';

const READ_ACTIONS = [
  'list_workflows',
  'get_workflow',
  'list_executions',
  'get_execution',
] as const;
const WRITE_ACTIONS = ['activate_workflow', 'deactivate_workflow'] as const;

const TIMEOUT_MS = 15_000;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const ERROR_BODY_CHARS = 300;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const CURSOR_RE = /^[A-Za-z0-9+/=_-]{1,512}$/;
const STATUS_RE = /^[a-z]{1,20}$/;

export const readDefinition: Tool = {
  name: 'nio_lang_n8n',
  description:
    'Lê de uma instância n8n (somente leitura): lista/consulta workflows e execuções. ' +
    'Requer N8N_API_URL e N8N_API_KEY no ambiente.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: [...READ_ACTIONS], description: 'Operação de leitura.' },
      id: { type: 'string', description: 'Id do workflow/execução (get_*).' },
      active: { type: 'boolean', description: 'list_workflows: filtra por ativos/inativos.' },
      workflowId: { type: 'string', description: 'list_executions: filtra por workflow.' },
      status: { type: 'string', description: 'list_executions: ex. success, error, waiting.' },
      limit: {
        type: 'number',
        description: `Itens por página (1–${MAX_LIMIT}, padrão ${DEFAULT_LIMIT}).`,
      },
      cursor: { type: 'string', description: 'nextCursor da página anterior.' },
    },
    required: ['action'],
  },
};

export const writeDefinition: Tool = {
  name: 'nio_lang_n8n_write',
  description:
    'ALTERA estado numa instância n8n: ativa ou desativa um workflow. Exige aprovação do ' +
    'usuário. Requer N8N_API_URL e N8N_API_KEY no ambiente.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: [...WRITE_ACTIONS], description: 'Operação de escrita.' },
      id: { type: 'string', description: 'Id do workflow.' },
    },
    required: ['action', 'id'],
  },
};

export interface N8nDeps {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
}

interface N8nConfig {
  base: string;
  key: string;
}

/** `N8N_API_URL` → base `…/api/v1`. Aceita a instância com ou sem o sufixo, http ou https. */
function readConfig(env: NodeJS.ProcessEnv): N8nConfig | string {
  const rawUrl = env.N8N_API_URL?.trim();
  const key = env.N8N_API_KEY?.trim();
  if (!rawUrl || !key) {
    return 'N8N_API_URL e N8N_API_KEY não definidas. Exporte as duas (a chave nasce em Settings > n8n API).';
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return `N8N_API_URL inválida: "${rawUrl.slice(0, 40)}".`;
  }
  if (!isTransportTrusted(url)) return `N8N_API_URL precisa ser https — ${PLAIN_HTTP_HINT}.`;
  const root = url.href.replace(/\/+$/, '').replace(/\/api\/v1$/, '');
  return { base: `${root}/api/v1`, key };
}

async function call(
  cfg: N8nConfig,
  method: 'GET' | 'POST',
  path: string,
  query: URLSearchParams,
  doFetch: typeof fetch,
): Promise<CallToolResult> {
  const qs = query.size > 0 ? `?${query}` : '';
  try {
    const res = await doFetch(`${cfg.base}${path}${qs}`, {
      method,
      headers: { 'X-N8N-API-KEY': cfg.key, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403) {
      return errorResult(
        `n8n recusou a chave (HTTP ${res.status}) — confira N8N_API_KEY e os escopos dela.`,
      );
    }
    if (!res.ok) {
      const body = (await res.text()).slice(0, ERROR_BODY_CHARS);
      return errorResult(`n8n respondeu HTTP ${res.status}: ${body}`);
    }
    return jsonResult(await res.json());
  } catch (err) {
    const name = (err as Error).name;
    if (name === 'TimeoutError') return errorResult(`n8n não respondeu em ${TIMEOUT_MS / 1000}s.`);
    return errorResult(`falha ao falar com o n8n: ${(err as Error).message}`);
  }
}

function pageQuery(a: Record<string, unknown>): URLSearchParams | string {
  const q = new URLSearchParams();
  const limit = a.limit === undefined ? DEFAULT_LIMIT : Number(a.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return `limit inválido: use um inteiro de 1 a ${MAX_LIMIT}.`;
  }
  q.set('limit', String(limit));
  if (a.cursor !== undefined) {
    if (typeof a.cursor !== 'string' || !CURSOR_RE.test(a.cursor)) return 'cursor inválido.';
    q.set('cursor', a.cursor);
  }
  return q;
}

function idOf(a: Record<string, unknown>, field = 'id'): string | undefined {
  const v = a[field];
  return typeof v === 'string' && ID_RE.test(v) ? v : undefined;
}

export async function handleLangN8n(args: unknown, deps: N8nDeps = {}): Promise<CallToolResult> {
  const a = (args ?? {}) as Record<string, unknown>;
  if (!READ_ACTIONS.includes(a.action as never)) {
    return errorResult(`action inválida. Use uma de: ${READ_ACTIONS.join(', ')}.`);
  }
  const cfg = readConfig(deps.env ?? process.env);
  if (typeof cfg === 'string') return errorResult(cfg);
  const doFetch = deps.fetch ?? fetch;

  if (a.action === 'get_workflow' || a.action === 'get_execution') {
    const id = idOf(a);
    if (!id) return errorResult('id obrigatório (letras, números, "_" ou "-").');
    const path = a.action === 'get_workflow' ? `/workflows/${id}` : `/executions/${id}`;
    return call(cfg, 'GET', path, new URLSearchParams(), doFetch);
  }

  const q = pageQuery(a);
  if (typeof q === 'string') return errorResult(q);
  if (a.action === 'list_workflows') {
    if (typeof a.active === 'boolean') q.set('active', String(a.active));
    return call(cfg, 'GET', '/workflows', q, doFetch);
  }
  if (a.workflowId !== undefined) {
    const wf = idOf(a, 'workflowId');
    if (!wf) return errorResult('workflowId inválido.');
    q.set('workflowId', wf);
  }
  if (a.status !== undefined) {
    if (typeof a.status !== 'string' || !STATUS_RE.test(a.status))
      return errorResult('status inválido.');
    q.set('status', a.status);
  }
  return call(cfg, 'GET', '/executions', q, doFetch);
}

export async function handleLangN8nWrite(
  args: unknown,
  deps: N8nDeps = {},
): Promise<CallToolResult> {
  const a = (args ?? {}) as Record<string, unknown>;
  if (!WRITE_ACTIONS.includes(a.action as never)) {
    return errorResult(`action inválida. Use uma de: ${WRITE_ACTIONS.join(', ')}.`);
  }
  const id = idOf(a);
  if (!id) return errorResult('id obrigatório (letras, números, "_" ou "-").');
  const cfg = readConfig(deps.env ?? process.env);
  if (typeof cfg === 'string') return errorResult(cfg);
  const verbo = a.action === 'activate_workflow' ? 'activate' : 'deactivate';
  return call(cfg, 'POST', `/workflows/${id}/${verbo}`, new URLSearchParams(), deps.fetch ?? fetch);
}
