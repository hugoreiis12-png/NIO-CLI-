/**
 * Cache por-usuário das tools detectadas na instância n8n, em `~/.nio/n8n/tools.json`.
 * Mesma ideia do cache de `~/.nio/lang` e `~/.nio/skills`.
 *
 * Existe porque a geração do `opencode.json` roda fora do wizard (`client-configs.ts`)
 * e precisa reconstruir o mesmo `askTools` que a detecção produziu. Cache ausente ou
 * corrompido devolve lista vazia — e lista vazia faz o spec voltar pro `*` (tudo pede).
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { homePath } from '../../brand.js';

export const N8N_TOOLS_CACHE = homePath('n8n', 'tools.json');

export interface N8nToolsCache {
  tools: string[];
  serverVersion?: string;
  detectedAt: string;
}

/** Lista vazia em qualquer problema — o caller trata isso como "sem detecção". */
export function readToolsCache(path = N8N_TOOLS_CACHE): N8nToolsCache {
  if (!existsSync(path)) return { tools: [], detectedAt: '' };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<N8nToolsCache>;
    const tools = Array.isArray(parsed.tools)
      ? parsed.tools.filter((tool): tool is string => typeof tool === 'string')
      : [];
    return {
      tools,
      detectedAt: typeof parsed.detectedAt === 'string' ? parsed.detectedAt : '',
      ...(typeof parsed.serverVersion === 'string' ? { serverVersion: parsed.serverVersion } : {}),
    };
  } catch {
    return { tools: [], detectedAt: '' };
  }
}

/** Não guarda segredo — só nomes de tool e a versão reportada pelo servidor. */
export function writeToolsCache(
  tools: string[],
  serverVersion?: string,
  path = N8N_TOOLS_CACHE,
): void {
  const payload: N8nToolsCache = {
    tools,
    detectedAt: new Date().toISOString(),
    ...(serverVersion ? { serverVersion } : {}),
  };
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}
