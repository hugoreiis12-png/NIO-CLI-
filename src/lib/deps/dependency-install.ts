import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, isAbsolute, parse } from 'node:path';
import { homePath } from '../../brand.js';
import type { DependencyPlan, ResolvedDependency } from './dependencies.js';

/**
 * Decide se uma dependência já está instalada e executa o plano quando o usuário
 * consente. Complementa `dependencies.ts` (resolução doc → plano) — este módulo é
 * a camada de IO: checagem no disco/subprocesso e o marcador de instalações.
 */

/** Registro do que o nio instalou: `~/.nio/installed-deps.json`. */
function markerPath(): string {
  return homePath('installed-deps.json');
}

function readMarker(): Record<string, { kind: string; ref: string; at: string }> {
  try {
    return JSON.parse(readFileSync(markerPath(), 'utf-8'));
  } catch {
    return {};
  }
}

/** Grava que instalamos esta dependência (idempotência p/ `skills`, que não tem local padrão). */
export function recordDependencyInstalled(dep: ResolvedDependency): void {
  const plan = dep.plan;
  if (!plan) return;
  const ref =
    plan.kind === 'npm'
      ? plan.pkg
      : plan.kind === 'skills'
        ? plan.repo
        : plan.kind === 'git'
          ? plan.url
          : plan.plugin; // claude-plugin
  const marker = readMarker();
  marker[dep.id] = { kind: plan.kind, ref, at: new Date().toISOString() };
  try {
    mkdirSync(dirname(markerPath()), { recursive: true });
    writeFileSync(markerPath(), JSON.stringify(marker, null, 2) + '\n');
  } catch {
    // best-effort — não bloqueia se ~/.nio não for gravável.
  }
}

/** Existe no disco (segue symlinks; symlink pendurado conta como ausente). */
function pathExists(p: string): boolean {
  try {
    lstatSync(p);
    // lstat pega o link; confirma que o alvo resolve (não é pendurado).
    return existsSync(p);
  } catch {
    return false;
  }
}

/** Expande `~` inicial pro home. */
function expandTilde(p: string): string {
  return p === '~' || p.startsWith('~/') || p.startsWith('~\\')
    ? join(homedir(), p.slice(1))
    : p;
}

/**
 * Existe algo casando o glob? Suporta `*` (um segmento) e `**` (qualquer
 * profundidade). Recursão limitada em profundidade pra não varrer demais.
 *
 * Exportada pra reuso pelo `adapters/pkg` (detecção de toolchain) — mesma
 * semântica de `detect:` das dependências.
 */
export function globExists(pattern: string): boolean {
  const expanded = expandTilde(pattern.trim());
  const abs = isAbsolute(expanded);
  // Raiz correta: `/` no POSIX, `C:\`/`C:/` no Windows (parse resolve os dois).
  // Sem isto, um path absoluto Windows caía em `start='/'` + segmento `C:` solto
  // e nunca casava (bug de detecção de toolchain no Windows).
  const root = abs ? parse(expanded).root : process.cwd();
  const rest = abs ? expanded.slice(parse(expanded).root.length) : expanded;
  const segs = rest.split(/[/\\]+/).filter(Boolean);
  return matchSegments(root, segs, 0, 0);
}

function matchSegments(base: string, segs: string[], i: number, depth: number): boolean {
  if (depth > 12) return false;
  if (i >= segs.length) return pathExists(base);

  const seg = segs[i];
  if (seg === '**') {
    if (matchSegments(base, segs, i + 1, depth)) return true; // zero dirs
    for (const child of childDirs(base)) {
      if (matchSegments(join(base, child), segs, i, depth + 1)) return true;
    }
    return false;
  }
  if (seg.includes('*')) {
    const re = new RegExp(
      '^' + seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
    );
    for (const child of childDirs(base)) {
      if (re.test(child) && matchSegments(join(base, child), segs, i + 1, depth + 1)) return true;
    }
    return false;
  }
  return matchSegments(join(base, seg), segs, i + 1, depth);
}

function childDirs(base: string): string[] {
  try {
    return readdirSync(base, { withFileTypes: true })
      .filter((e) => e.isDirectory() || e.isSymbolicLink())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/** Probe de locais conhecidos onde `npx skills add` costuma instalar. */
function skillInstalledElsewhere(repo: string): boolean {
  const name = repo.split('/').pop() ?? repo;
  return [
    join(homedir(), '.claude', 'skills', name),
    join(homedir(), '.codex', 'skills', name),
    join(process.cwd(), '.claude', 'skills', name),
    join(process.cwd(), 'skills', name),
  ].some((p) => existsSync(p));
}

/**
 * Já instalado? `npm` → `npm ls -g <pkg>` (autoritativo); `git` → dir de destino
 * existe; `skills` → sem local padrão, usa o marcador do nio + probe de dirs
 * conhecidos.
 */
export function isDependencyInstalled(dep: ResolvedDependency): boolean {
  // `detect:` vale pra qualquer tipo — inclusive `manual:` (plugins), que não têm plano.
  if (dep.detect && dep.detect.some(globExists)) return true;

  const plan = dep.plan;
  if (!plan) return false;
  if (plan.kind === 'git') return existsSync(plan.dest);
  if (plan.kind === 'npm') {
    const res = spawnSync('npm', ['ls', '-g', plan.pkg, '--depth=0'], { stdio: 'ignore' });
    return res.status === 0;
  }
  if (plan.kind === 'skills') {
    return Boolean(readMarker()[dep.id]) || skillInstalledElsewhere(plan.repo);
  }
  // claude-plugin: sem local padrão universal — o `detect:` (acima) é o sinal
  // primário; o marcador cobre o caso de já termos instalado nesta máquina.
  return Boolean(readMarker()[dep.id]);
}

export interface InstallOutcome {
  ok: boolean;
  code: number | null;
  error?: string;
}

/** Executa o plano. `spawnSync` com args em array e SEM shell — zero injeção. */
export function runDependencyInstall(plan: DependencyPlan): InstallOutcome {
  // claude-plugin: vários passos sequenciais (`marketplace add` → `install`).
  if (plan.kind === 'claude-plugin') {
    for (const step of plan.steps) {
      const res = spawnSync(step.program, step.args, { stdio: 'inherit' });
      if (res.error) return { ok: false, code: null, error: res.error.message };
      if (res.status !== 0) return { ok: false, code: res.status };
    }
    return { ok: true, code: 0 };
  }

  if (plan.kind === 'git') mkdirSync(dirname(plan.dest), { recursive: true });
  const res = spawnSync(plan.program, plan.args, { stdio: 'inherit' });
  if (res.error) return { ok: false, code: null, error: res.error.message };
  return { ok: res.status === 0, code: res.status };
}
