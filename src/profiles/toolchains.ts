/**
 * Toolchains reutilizados por vários perfis.
 *
 * NOTA: `detect` usa paths absolutos Unix. No Windows o `globExists`
 * (`lib/deps/dependency-install`) tem limitação conhecida com paths absolutos
 * (drive letter) — o toolchain sai como `failed` (aviso, NÃO-fatal: o ambiente
 * é incremental). Sem `install` universal (varia demais por SO), estes são
 * detectáveis mas não auto-instaláveis — orienta em vez de instalar.
 */
import type { ToolchainSpec } from '../core/environment.js';

export const nodeToolchain: ToolchainSpec = {
  id: 'node',
  detect: ['/usr/bin/node', '/usr/local/bin/node', '/opt/homebrew/bin/node'],
};

export const pythonToolchain: ToolchainSpec = {
  id: 'python',
  detect: ['/usr/bin/python3', '/usr/local/bin/python3', '/opt/homebrew/bin/python3'],
};
