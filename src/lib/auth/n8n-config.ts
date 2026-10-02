/**
 * Credencial do MCP nativo do n8n em `~/.nio/config.env`. Mesmo contrato do
 * `fabric-config.ts`: `prompt…` devolve o mapa de updates pro `writeConfigFile`, e
 * `verify…` testa **antes** de salvar.
 *
 * A verificação e a detecção de tools são a mesma chamada: validar o token já exige
 * listar as tools, e é a lista que define o `askTools` falha-fechado.
 */
import { input, password } from '../prompts.js';
import { detectNativeTools, normalizeNativeUrl } from '../../adapters/n8n/native-client.js';
import { writeToolsCache } from '../../adapters/n8n/tools-cache.js';
import { N8N_NATIVE_URL_ENV, N8N_NATIVE_TOKEN_ENV } from '../../profiles/mcps.js';
import { isN8nNativeReadTool } from '../../profiles/n8n-native-tools.js';

export interface N8nNativeStatus {
  configured: boolean;
  url?: string;
}

export function n8nNativeStatus(env: NodeJS.ProcessEnv = process.env): N8nNativeStatus {
  const url = env[N8N_NATIVE_URL_ENV]?.trim();
  const token = env[N8N_NATIVE_TOKEN_ENV]?.trim();
  return { configured: Boolean(url && token), ...(url ? { url } : {}) };
}

/**
 * Pergunta URL da instância e token. Devolve `null` se o usuário deixar a URL vazia
 * (pular). A URL é normalizada aqui para não gravar algo que o cliente recusaria depois.
 */
export async function promptN8nNativeCredentials(
  file: Record<string, string>,
): Promise<Record<string, string> | null> {
  console.log('  o token nasce em Settings > Instance-level MCP > Connect a client.');
  const raw = (
    await input({
      message: `${N8N_NATIVE_URL_ENV}  (URL da instância, vazio pra pular)`,
      default: file[N8N_NATIVE_URL_ENV] ?? process.env[N8N_NATIVE_URL_ENV] ?? '',
    })
  ).trim();
  if (!raw) return null;

  const url = normalizeNativeUrl(raw);
  if (typeof url !== 'string') {
    console.log(`  ${url.error}`);
    return null;
  }
  const token = (
    await password({ message: `${N8N_NATIVE_TOKEN_ENV}  (token do MCP)`, mask: '*' })
  ).trim();
  return { [N8N_NATIVE_URL_ENV]: url, [N8N_NATIVE_TOKEN_ENV]: token };
}

export interface N8nVerifyResult {
  ok: boolean;
  detail: string;
  tools?: string[];
}

/**
 * Conecta no MCP da instância com o que o wizard acabou de coletar (não com o env do
 * processo) e, dando certo, grava o cache de tools — é dele que sai o `askTools`.
 */
export async function verifyN8nNativeCredentials(
  updates: Record<string, string>,
): Promise<N8nVerifyResult> {
  const url = updates[N8N_NATIVE_URL_ENV] ?? '';
  const token = updates[N8N_NATIVE_TOKEN_ENV] ?? '';
  const res = await detectNativeTools(url, token);
  if (!res.ok || !res.tools) return { ok: false, detail: res.error ?? 'falha na detecção' };

  writeToolsCache(res.tools, res.serverVersion);
  const ask = res.tools.filter((tool) => !isN8nNativeReadTool(tool)).length;
  const versao = res.serverVersion ? ` em ${res.serverVersion}` : '';
  return {
    ok: true,
    tools: res.tools,
    detail: `${res.tools.length} tools${versao} — ${res.tools.length - ask} livres, ${ask} pedem aprovação`,
  };
}
