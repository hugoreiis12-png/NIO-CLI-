import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

interface Pkg {
  version: string;
  dependencies?: Record<string, string>;
}

function loadPkg(): Pkg {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    return JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf-8')) as Pkg;
  } catch {
    return { version: '0.0.0' };
  }
}

const pkg = loadPkg();

export const VERSION = pkg.version;

/** `a > b` em semver simples (major.minor.patch; ignora pré-release). */
export function semverGt(a: string, b: string): boolean {
  const pa = a.split('-')[0]!.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('-')[0]!.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false;
  }
  return false;
}

/**
 * Versão do `@opencode-ai/sdk` que a CLI embute (o pin exato do `package.json`).
 * É contra ela que o binário `opencode` no PATH tem que estar alinhado — o
 * protocolo do `opencode serve` (stream SSE, shape do `session.prompt`) pode
 * divergir entre minors (auditoria §4.2).
 */
export const OPENCODE_SDK_VERSION = pkg.dependencies?.['@opencode-ai/sdk']?.replace(/^[\^~]/, '') ?? null;
