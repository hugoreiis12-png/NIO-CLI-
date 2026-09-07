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
import { codeloadZipUrl, fetchZipball, rejectSymlinks } from '../../lib/fetch-zipball.js';
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

  const url = codeloadZipUrl(spec.repo, spec.ref);
  const staging = join(tmpdir(), `nio-lang-${spec.dir}-${process.pid}-${Date.now()}`);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const buf = await fetchZipball(url, { timeoutMs });

    // O zipball tem um único dir raiz (`<repo>-<ref>/`); extrai e mira nele.
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    new AdmZip(buf).extractAllTo(staging, true);
    const dirs = readdirSync(staging, { withFileTypes: true }).filter((e) => e.isDirectory());
    const root = dirs.length === 1 ? join(staging, dirs[0].name) : staging;
    rejectSymlinks(root); // TP-4

    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
    cpSync(root, dest, { recursive: true });

    return { ...base, status: 'fetched' };
  } catch (err) {
    return { ...base, status: existsSync(dest) ? 'cached' : 'failed', error: (err as Error).message };
  } finally {
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
