/**
 * Vendoring dos repos de linguagem pro cache `~/.nio/lang/` (fatia 2 do
 * `nio-lang`). Mesmo padrão do `skills-cache`: zipball do GitHub via `fetch`
 * (Node 20+) + `adm-zip`, sem dependência de `git`, com timeout e idempotência.
 * O `nio lang sync` chama isto; o `knowledge-store` lê o resultado.
 */
import { existsSync, mkdirSync, rmSync, cpSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { homePath } from '../../brand.js';
import { LANG_REPOS, type LangRepo } from './repos.js';

const DEFAULT_TIMEOUT_MS = 30_000;

export interface RepoSyncResult {
  dir: string;
  repo: string;
  ref: string;
  /** `fetched` = baixou · `cached` = já tinha (ou falhou mas há cache) · `failed` = sem conteúdo. */
  status: 'fetched' | 'cached' | 'failed';
  error?: string;
}

async function downloadRepo(
  spec: LangRepo,
  baseDir: string,
  opts: { force?: boolean; timeoutMs?: number },
): Promise<RepoSyncResult> {
  const dest = join(baseDir, spec.dir);
  const base = { dir: spec.dir, repo: spec.repo, ref: spec.ref };

  if (!opts.force && existsSync(dest)) {
    return { ...base, status: 'cached' };
  }

  const url = `https://codeload.github.com/${spec.repo}/zip/refs/heads/${spec.ref}`;
  const staging = join(tmpdir(), `nio-lang-${spec.dir}-${process.pid}-${Date.now()}`);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());

    // O zipball tem um único dir raiz (`<repo>-<ref>/`); extrai e mira nele.
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    new AdmZip(buf).extractAllTo(staging, true);
    const dirs = readdirSync(staging, { withFileTypes: true }).filter((e) => e.isDirectory());
    const root = dirs.length === 1 ? join(staging, dirs[0].name) : staging;

    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
    cpSync(root, dest, { recursive: true });

    return { ...base, status: 'fetched' };
  } catch (err) {
    const msg = ac.signal.aborted ? `timeout após ${timeoutMs}ms` : (err as Error).message;
    return { ...base, status: existsSync(dest) ? 'cached' : 'failed', error: msg };
  } finally {
    clearTimeout(timer);
    rmSync(staging, { recursive: true, force: true });
  }
}

/**
 * Sincroniza os 5 repos de linguagem pro cache. `dir` é seam opcional pra teste.
 * Best-effort por repo — um que falhe não derruba os outros.
 */
export async function syncLangRepos(
  opts: { force?: boolean; timeoutMs?: number; dir?: string } = {},
): Promise<RepoSyncResult[]> {
  const baseDir = opts.dir ?? homePath('lang');
  mkdirSync(baseDir, { recursive: true });
  const results: RepoSyncResult[] = [];
  for (const spec of Object.values(LANG_REPOS)) {
    results.push(await downloadRepo(spec, baseDir, opts));
  }
  return results;
}
