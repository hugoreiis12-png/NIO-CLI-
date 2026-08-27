/**
 * Helpers comuns às tools de sessão/ambiente do MCP server principal
 * (`nio_session_*`, `nio_env_*`). Todas orquestram via `SessionManager` e
 * compartilham a serialização da `Session` e o mapeamento de erro.
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Session } from '../core/session.js';
import type { EnsureResult } from '../core/environment.js';
import { errorResult } from '../lib/tool-result.js';
import { SessionNotFoundError, AmbiguousSessionError } from '../app/session-manager.js';

/** View pública de uma `Session` pra saída de tool (datas em ISO). */
export function sessionView(s: Session): Record<string, unknown> {
  return {
    id: s.id,
    name: s.name,
    profile: s.profile,
    status: s.status,
    project_path: s.projectPath,
    ide: s.ide,
    config: s.config,
    created_at: s.createdAt.toISOString(),
    updated_at: s.updatedAt.toISOString(),
  };
}

/** Toolchains que falharam a materialização — pro chamador reportar. */
export function failedToolchains(results: EnsureResult[]): { id: string; error?: string }[] {
  return results.filter((t) => t.status === 'failed').map((t) => ({ id: t.id, error: t.error }));
}

/**
 * Mapeia erros do fluxo de sessão pra um `errorResult` amigável: erros de
 * resolução (não achou / ambíguo) mostram a mensagem direta; o resto vira
 * `Falha ao <context>: …` (tipicamente banco indisponível ou materialização).
 */
export function sessionErrorResult(err: unknown, context = 'acessar as sessões'): CallToolResult {
  if (err instanceof SessionNotFoundError || err instanceof AmbiguousSessionError) {
    return errorResult(err.message);
  }
  return errorResult(`Falha ao ${context}: ${(err as Error).message}`);
}
