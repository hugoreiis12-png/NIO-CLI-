import {
  existsSync,
  mkdirSync,
  rmSync,
  cpSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { brand, env, homePath } from '../brand.js';

/**
 * Skills como repo aberto (não pacote npm): o CLI baixa o zipball do GitHub pro
 * cache local (`~/.nio/skills`) e lê de lá — `skillsDir()` resolve pra cá sem
 * checkout, e `nio sync` atualiza o cache sem republicar o CLI.
 */

const DEFAULT_REPO = brand.skillsRepo;
const DEFAULT_REF = brand.skillsRef;

/** `owner/repo` do repo de skills. Sobrescrevível via `NIO_SKILLS_REPO`. */
export function skillsRepo(): string {
  return env('SKILLS_REPO') || DEFAULT_REPO;
}

/** Branch/tag a baixar. Sobrescrevível via `NIO_SKILLS_REF`. */
export function skillsRef(): string {
  return env('SKILLS_REF') || DEFAULT_REF;
}

/** Raiz do cache local (o conteúdo do repo: `commands/`, `skills/`, `hooks/`, …). */
export function skillsCacheDir(): string {
  return homePath('skills');
}

const MARKER = `${brand.homeDirName}-skills.json`;

interface CacheMeta {
  repo: string;
  ref: string;
  fetchedAt: string;
}

/** Metadados do último fetch (repo/ref/quando). `null` se o cache não existe. */
export function cacheMeta(): CacheMeta | null {
  const p = join(skillsCacheDir(), MARKER);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as CacheMeta;
  } catch {
    return null;
  }
}

/** O cache existe e parece válido (tem ao menos `skills/` ou `commands/`)? */
export function skillsCached(): boolean {
  const dir = skillsCacheDir();
  return existsSync(join(dir, 'skills')) || existsSync(join(dir, 'commands'));
}

export interface FetchResult {
  /** `fetched` = baixou agora · `cached` = já tinha (ou fetch falhou mas há cache) · `failed` = sem conteúdo. */
  status: 'fetched' | 'cached' | 'failed';
  dir: string;
  repo: string;
  ref: string;
  /** Mensagem do erro de rede, se o fetch falhou (mesmo caindo pro cache). */
  error?: string;
}

/**
 * Baixa o repo de skills (zipball do GitHub) pro cache local. Sem `git` — usa
 * `fetch` (Node 20+) + `adm-zip`. Idempotente: com `force=false` e cache presente,
 * não toca a rede. Se o download falhar mas houver cache antigo, segue com ele.
 */
/** Timeout do download — sem isto o `fetch` pode pendurar no connect pra sempre. */
const DEFAULT_TIMEOUT_MS = 20_000;

export async function fetchSkills(
  opts: { force?: boolean; timeoutMs?: number } = {},
): Promise<FetchResult> {
  const dir = skillsCacheDir();
  const repo = skillsRepo();
  const ref = skillsRef();

  if (!opts.force && skillsCached()) {
    return { status: 'cached', dir, repo, ref };
  }

  const url = `https://codeload.github.com/${repo}/zip/refs/heads/${ref}`;
  const staging = join(tmpdir(), `${brand.name}-skills-${process.pid}-${Date.now()}`);
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

    // Substitui o cache pelo conteúdo baixado.
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    cpSync(root, dir, { recursive: true });

    const meta: CacheMeta = { repo, ref, fetchedAt: new Date().toISOString() };
    writeFileSync(join(dir, MARKER), JSON.stringify(meta, null, 2) + '\n', 'utf8');

    return { status: 'fetched', dir, repo, ref };
  } catch (err) {
    const msg = ac.signal.aborted
      ? `timeout após ${timeoutMs}ms baixando ${url}`
      : (err as Error).message;
    if (skillsCached()) {
      return { status: 'cached', dir, repo, ref, error: msg };
    }
    return { status: 'failed', dir, repo, ref, error: msg };
  } finally {
    clearTimeout(timer);
    rmSync(staging, { recursive: true, force: true });
  }
}

/** Garante que o cache exista (baixa só se ausente). Best-effort pro runtime do MCP. */
export async function ensureSkillsCache(): Promise<FetchResult> {
  return fetchSkills({ force: false });
}
