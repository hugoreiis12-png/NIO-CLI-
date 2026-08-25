/**
 * `ProjectDetector` (`core/lang.ts`) — inspeciona o diretório do projeto pra
 * sinalizar o contexto (greenfield vs. brownfield, ecossistema, package manager).
 * Read-only, nunca lança. É o que permite o scaffold instalar "de acordo com o
 * projeto" (regra do dono do projeto), em vez de cego.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ProjectContext, ProjectDetector } from '../../core/lang.js';

/** Entradas que não contam pra decidir se o dir é "vazio" (greenfield). */
const IGNORE = new Set(['.git', '.nio-lang.json', '.DS_Store', 'Thumbs.db']);

function listDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function isEmpty(dir: string): boolean {
  return listDir(dir).filter((f) => !IGNORE.has(f)).length === 0;
}

/** Lockfile → package manager node (precedência pnpm > yarn > npm). */
function detectNodePm(dir: string): string | undefined {
  if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(dir, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(dir, 'package-lock.json'))) return 'npm';
  return undefined;
}

export function createProjectDetector(): ProjectDetector {
  return {
    detect(targetDir: string): ProjectContext {
      const has = (f: string) => existsSync(join(targetDir, f));
      return {
        targetDir,
        empty: isEmpty(targetDir),
        hasPackageJson: has('package.json'),
        hasPyproject: has('pyproject.toml'),
        hasRequirements: has('requirements.txt'),
        hasCsproj: listDir(targetDir).some((f) => f.endsWith('.csproj')),
        nodePackageManager: detectNodePm(targetDir),
      };
    },
  };
}
