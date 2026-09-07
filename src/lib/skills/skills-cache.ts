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
import { brand, env, homePath } from '../../brand.js';
import { codeloadZipUrl, fetchZipball, isPinnedRef, rejectSymlinks } from '../fetch-zipball.js';
import { VERSION, semverGt } from '../../version.js';

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

/**
 * TTL do cache (Sprint 5.5): num host que só roda o operador e nunca chama
 * `nio sync`, o cache ficaria velho pra sempre. `ensureSkillsCache()` re-baixa
 * passado esse tempo. `nio sync` continua forçando (é a atualização explícita).
 */
export const SKILLS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Pura: a idade de um `fetchedAt` (ISO) passou o TTL? Ausente/inválido → `true`
 * (força um fetch, que degrada pro cache se a rede falhar).
 */
export function isFetchedAtStale(
  fetchedAt: string | null | undefined,
  ttlMs: number = SKILLS_TTL_MS,
  now: number = Date.now(),
): boolean {
  if (!fetchedAt) return true;
  const age = now - new Date(fetchedAt).getTime();
  return Number.isNaN(age) || age > ttlMs;
}

/** O cache local está velho o bastante pra re-baixar? (lê o marker `.nio-skills.json`) */
export function skillsCacheStale(ttlMs: number = SKILLS_TTL_MS, now: number = Date.now()): boolean {
  return isFetchedAtStale(cacheMeta()?.fetchedAt, ttlMs, now);
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

  // H-3: `ref` deve ser um commit SHA (imutável). Branch/tag = fonte não-pinada:
  // o conteúdo vira hooks executados + planos de instalação, então avisamos alto.
  if (!isPinnedRef(ref)) {
    console.error(
      `[${brand.mcpBinName}] AVISO: skills vêm de "${ref}" (não é um commit SHA). ` +
        'Fonte não-pinada = execução de código sem revisão. Pine `brand.skillsRef` a um SHA.',
    );
  }

  const url = codeloadZipUrl(repo, ref);
  const staging = join(tmpdir(), `${brand.name}-skills-${process.pid}-${Date.now()}`);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const buf = await fetchZipball(url, { timeoutMs });

    // O zipball tem um único dir raiz (`<repo>-<ref>/`); extrai e mira nele.
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    new AdmZip(buf).extractAllTo(staging, true);
    const dirs = readdirSync(staging, { withFileTypes: true }).filter((e) => e.isDirectory());
    const root = dirs.length === 1 ? join(staging, dirs[0].name) : staging;
    rejectSymlinks(root); // TP-4 — nada de `x -> ~/.ssh/id_rsa` no bundle

    // Substitui o cache pelo conteúdo baixado.
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    cpSync(root, dir, { recursive: true });

    const meta: CacheMeta = { repo, ref, fetchedAt: new Date().toISOString() };
    writeFileSync(join(dir, MARKER), JSON.stringify(meta, null, 2) + '\n', 'utf8');

    return { status: 'fetched', dir, repo, ref };
  } catch (err) {
    const msg = (err as Error).message;
    if (skillsCached()) {
      return { status: 'cached', dir, repo, ref, error: msg };
    }
    return { status: 'failed', dir, repo, ref, error: msg };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/**
 * Garante o cache pro runtime do MCP: baixa se ausente, **velho** (TTL), ou se o
 * `ref` pinado mudou (upgrade da CLI que bumpou `brand.skillsRef`). Cache fresco e
 * no ref certo → `cached` sem tocar a rede. Best-effort — fetch que falha com
 * cache presente segue com o cache (`fetchSkills`).
 */
export async function ensureSkillsCache(): Promise<FetchResult> {
  const refMatches = cacheMeta()?.ref === skillsRef();
  if (skillsCached() && refMatches && !skillsCacheStale()) {
    return fetchSkills({ force: false });
  }
  return fetchSkills({ force: true });
}

/**
 * O bundle de skills no cache exige uma CLI mais nova que esta? (§4.1 da
 * auditoria). Lê `nio-skills.json` na raiz do cache — `{ "min_cli_version":
 * "x.y.z" }`. Ausente / ilegível → `null` (bundle antigo, sem contrato). Warn,
 * não bloqueio: o caller avisa e segue.
 */
export function skillsMinCliWarning(dir: string = skillsCacheDir(), cliVersion: string = VERSION): string | null {
  try {
    const raw = readFileSync(join(dir, 'nio-skills.json'), 'utf8');
    const min = (JSON.parse(raw) as { min_cli_version?: unknown }).min_cli_version;
    if (typeof min !== 'string' || !semverGt(min, cliVersion)) return null;
    return (
      `o bundle de skills pede a CLI >= ${min}, mas esta é ${cliVersion}. ` +
      `Atualize: npm i -g ${brand.packageName}. Skills podem se comportar de forma inesperada.`
    );
  } catch {
    return null;
  }
}
