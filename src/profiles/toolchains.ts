/**
 * Toolchains reutilizados por vários perfis.
 *
 * `detect` mistura globs Unix + Windows (`C:/...` com `/`; o `globExists`
 * de `lib/deps/dependency-install` resolve a raiz por `parse().root`, então
 * drive letter funciona). Globs recursivos ficam restritos a subpaths de vendor
 * (`Program Files/<Vendor>/...`) pra não varrer o disco (limite `depth>12`).
 *
 * `install` (só Windows, via `winget`) — em POSIX a spec fica só-detectável e o
 * gateway degrada pra `failed` com orientação, como antes.
 */
import type { ToolchainSpec } from '../core/environment.js';

/** `install` via `winget`, só resolvido no Windows (em POSIX vira spec só-detectável). */
function wingetInstall(id: string): ToolchainSpec['install'] | undefined {
  if (process.platform !== 'win32') return undefined;
  return {
    program: 'winget',
    args: [
      'install',
      '-e',
      '--id',
      id,
      '--silent',
      '--accept-package-agreements',
      '--accept-source-agreements',
    ],
  };
}

export const nodeToolchain: ToolchainSpec = {
  id: 'node',
  detect: [
    '/usr/bin/node',
    '/usr/local/bin/node',
    '/opt/homebrew/bin/node',
    'C:/Program Files/nodejs/node.exe',
    'C:/Program Files (x86)/nodejs/node.exe',
  ],
};

export const pythonToolchain: ToolchainSpec = {
  id: 'python',
  detect: [
    '/usr/bin/python3',
    '/usr/local/bin/python3',
    '/opt/homebrew/bin/python3',
    'C:/Python3*/python.exe',
    'C:/Program Files/Python*/python.exe',
  ],
};

/** Cliente `psql` — SQL local pros perfis `dba` e `bi`. Extraído do `dba.ts`. */
export const postgresqlClientToolchain: ToolchainSpec = {
  id: 'postgresql-client',
  detect: [
    '/usr/bin/psql',
    '/usr/local/bin/psql',
    '/opt/homebrew/bin/psql',
    'C:/Program Files/PostgreSQL/**/bin/psql.exe',
    'C:/Program Files (x86)/PostgreSQL/**/bin/psql.exe',
  ],
  install: wingetInstall('PostgreSQL.PostgreSQL'),
};

/**
 * Power BI Desktop — modelagem local pro perfil `bi` (par do MCP
 * `powerbi-modeling`, que fala com o Desktop aberto). Instalador pesado
 * (~1.5GB); o gateway mostra o progresso (`stdio: inherit`) e nunca aborta.
 */
export const powerbiDesktopToolchain: ToolchainSpec = {
  id: 'powerbi-desktop',
  detect: [
    'C:/Program Files/Microsoft Power BI Desktop/**/PBIDesktop.exe',
    'C:/Program Files/Microsoft Power BI Desktop RS/**/PBIDesktop.exe',
  ],
  install: wingetInstall('Microsoft.PowerBIDesktop'),
};
