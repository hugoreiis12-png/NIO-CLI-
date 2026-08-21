import updateNotifier, { type UpdateInfo } from 'update-notifier';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { brand } from '../brand.js';

function loadPkg(): { name: string; version: string } {
  // Este módulo compila pra `dist/lib/version-check.js`, então o package.json fica
  // dois níveis acima (raiz do pacote). Mesmo truque do `packageRoot()` do cowork-extension.
  const here = dirname(fileURLToPath(import.meta.url));
  const pkgPath = join(here, '..', '..', 'package.json');
  return JSON.parse(readFileSync(pkgPath, 'utf-8')) as { name: string; version: string };
}

const ONE_DAY_MS = 1000 * 60 * 60 * 24;

/**
 * Inicia checagem em background (cacheada). Retorna o objeto pra inspeção.
 */
export function startVersionCheck() {
  const pkg = loadPkg();
  return updateNotifier({ pkg, updateCheckInterval: ONE_DAY_MS });
}

/**
 * Pro CLI interativo: chama .notify() com banner padrão no stdout.
 */
export function notifyCliIfUpdate(): void {
  try {
    const notifier = startVersionCheck();
    notifier.notify({ defer: false, isGlobal: true });
  } catch {
    // Best-effort. Nunca quebrar o CLI por causa de checagem de versão.
  }
}

export interface UpdateStatus {
  name: string;
  current: string;
  latest: string;
  hasUpdate: boolean;
}

/** `a > b` em semver simples (major.minor.patch; ignora pré-release). */
function semverGt(a: string, b: string): boolean {
  const pa = a.split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false;
  }
  return false;
}

/**
 * Consulta o registro npm pela última versão publicada e compara com a instalada.
 * Retorna `null` em qualquer falha (offline, timeout, registro bloqueado) — nunca
 * quebra o fluxo do CLI. Usado pelo `nio sync` pra oferecer atualizar.
 */
export async function checkForUpdate(timeoutMs = 3000): Promise<UpdateStatus | null> {
  try {
    const pkg = loadPkg();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`https://registry.npmjs.org/${pkg.name}/latest`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    const latest = data.version;
    if (!latest) return null;
    return { name: pkg.name, current: pkg.version, latest, hasUpdate: semverGt(latest, pkg.version) };
  } catch {
    return null;
  }
}

/**
 * Pro MCP server: SEM banner em stdout (corromperia JSON-RPC).
 * Loga em stderr só se houver update — o Claude Code captura stderr.
 */
export function notifyMcpServerIfUpdate(): void {
  try {
    const notifier = startVersionCheck();
    const update: UpdateInfo | undefined = notifier.update;
    if (update && update.latest !== update.current) {
      console.error(
        `[${brand.mcpBinName}] nova versão disponível: ${update.current} → ${update.latest}. ` +
          `Atualize com: npm i -g ${brand.packageName}`,
      );
    }
  } catch {
    // idem: best-effort.
  }
}
