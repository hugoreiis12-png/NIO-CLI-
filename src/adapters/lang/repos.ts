/**
 * Os 5 repos que o `nio-lang` centraliza (fetch-cache em `~/.nio/lang/<dir>`).
 * Fonte única do mapeamento linguagem → repo/dir/ref — usado pelo `vendor`
 * (baixa) e pelo `knowledge-store` (lê). Ver `docs/v2/ARQUITETURA-NIO-LANG.md`.
 */
import type { LanguageId } from '../../core/lang.js';

export interface LangRepo {
  /** Subdir no cache: `~/.nio/lang/<dir>`. */
  dir: string;
  /** `owner/repo` no GitHub. */
  repo: string;
  /** Branch/tag a baixar (fixada pra reprodutibilidade). */
  ref: string;
}

export const LANG_REPOS: Record<LanguageId, LangRepo> = {
  python: { dir: 'python-sdk', repo: 'modelcontextprotocol/python-sdk', ref: 'main' },
  typescript: { dir: 'typescript-sdk', repo: 'modelcontextprotocol/typescript-sdk', ref: 'main' },
  csharp: { dir: 'csharp-sdk', repo: 'modelcontextprotocol/csharp-sdk', ref: 'main' },
  node: { dir: 'mcp-server-node', repo: 'lucianoayres/mcp-server-node', ref: 'main' },
  n8n: { dir: 'n8n-mcp', repo: 'czlonkowski/n8n-mcp', ref: 'main' },
};
