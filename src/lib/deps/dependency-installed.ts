/**
 * Diff de instalados (fatia 2 do DependencyWatcher — Sprint 3). Dado o que o
 * scanner achou DECLARADO, decide o que ainda NÃO está instalado no projeto —
 * checagem só por filesystem (barata, sem subprocesso), best-effort por
 * ecossistema. Indeterminado conta como "não instalado" (o auto-install é opt-in,
 * então um falso-negativo no máximo dispara um install idempotente, nunca perde dep).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ScannedDependency } from './dependency-scan.js';

/** npm: instalado = existe `node_modules/<name>` (path join lida com `@scope/name`). */
function npmInstalled(name: string, projectPath: string): boolean {
  return existsSync(join(projectPath, 'node_modules', name));
}

/** Diretórios de virtualenv comuns onde procurar site-packages do pip. */
const VENV_DIRS = ['.venv', 'venv', 'env'];

/**
 * pip: instalado = há um `<name>`/`<name>-*.dist-info`/`.egg-info` em algum
 * site-packages de venv do projeto. Nome normalizado (pip troca `-`/`.` por `_`
 * e é case-insensitive nos dist-info).
 */
function pipInstalled(name: string, projectPath: string): boolean {
  const norm = name.toLowerCase().replace(/[-.]/g, '_');
  for (const venv of VENV_DIRS) {
    // POSIX: <venv>/lib/pythonX.Y/site-packages ; Windows: <venv>/Lib/site-packages
    for (const sp of sitePackagesDirs(join(projectPath, venv))) {
      for (const entry of safeReaddir(sp)) {
        const e = entry.toLowerCase().replace(/[-.]/g, '_');
        if (e === norm || e.startsWith(`${norm}_`)) return true; // `<name>`, `<name>-1.0.dist-info`, egg-info
      }
    }
  }
  return false;
}

/** Candidatos de site-packages sob um dir de venv (POSIX + Windows). */
function sitePackagesDirs(venvPath: string): string[] {
  const dirs: string[] = [join(venvPath, 'Lib', 'site-packages')]; // Windows
  const libPath = join(venvPath, 'lib'); // POSIX: lib/pythonX.Y/site-packages
  for (const py of safeReaddir(libPath)) {
    if (py.startsWith('python')) dirs.push(join(libPath, py, 'site-packages'));
  }
  return dirs;
}

/** cargo: instalado = o crate aparece em `Cargo.lock` (`name = "<crate>"`). */
function cargoInstalled(name: string, projectPath: string): boolean {
  try {
    const lock = readFileSync(join(projectPath, 'Cargo.lock'), 'utf8');
    // Match por linha exata do Cargo.lock — `name = "serde"`.
    return new RegExp(`^name = "${escapeRegex(name)}"$`, 'm').test(lock);
  } catch {
    return false;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** Uma dependência escaneada já está instalada no projeto? */
export function isInstalled(dep: ScannedDependency, projectPath: string): boolean {
  switch (dep.type) {
    case 'npm':
      return npmInstalled(dep.name, projectPath);
    case 'pip':
      return pipInstalled(dep.name, projectPath);
    case 'cargo':
      return cargoInstalled(dep.name, projectPath);
    default:
      return false; // gem/composer/unknown ainda não checados — tratados como ausentes
  }
}

/**
 * Subconjunto das deps escaneadas que ainda não estão instaladas. O `check` é
 * injetável (default `isInstalled`) pra o app layer testar sem tocar o disco.
 */
export function missingDependencies(
  scanned: ScannedDependency[],
  projectPath: string,
  check: (dep: ScannedDependency, projectPath: string) => boolean = isInstalled,
): ScannedDependency[] {
  return scanned.filter((dep) => !check(dep, projectPath));
}
