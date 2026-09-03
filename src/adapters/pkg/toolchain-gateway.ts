/**
 * Adapter `pkg` — implementação do `ToolchainGateway` (`core/environment.ts`).
 * Garante um toolchain no host: detecta por glob (reusa `globExists` de
 * `lib/deps/dependency-install`) e, se faltar e houver plano, instala via `spawnSync`
 * SEM shell (mesmo padrão seguro de `runDependencyInstall` — args em array, zero
 * interpolação de string).
 *
 * **Nunca lança** (contrato do port): qualquer falha vira `status: 'failed'`.
 */
import { spawnSyncPortable } from '../../lib/proc.js';
import { globExists } from '../../lib/deps/dependency-install.js';
import type { EnsureResult, ToolchainGateway, ToolchainSpec } from '../../core/environment.js';

/** Detectado no disco por qualquer um dos globs de `detect`. */
function isPresent(spec: ToolchainSpec): boolean {
  return Boolean(spec.detect && spec.detect.some(globExists));
}

function ensure(spec: ToolchainSpec): EnsureResult {
  if (isPresent(spec)) return { id: spec.id, status: 'present' };

  if (!spec.install) {
    return {
      id: spec.id,
      status: 'failed',
      error: 'não detectado e sem plano de instalação automática (instale manualmente)',
    };
  }

  // spawnSyncPortable: acha shims `.cmd`/`.bat` no Windows (ex.: npm). Program/args
  // vêm do catálogo de toolchains, nunca do usuário.
  const res = spawnSyncPortable(spec.install.program, spec.install.args, { stdio: 'inherit' });
  if (res.error) {
    return { id: spec.id, status: 'failed', error: res.error.message };
  }
  if (res.status !== 0) {
    return { id: spec.id, status: 'failed', error: `instalador saiu com código ${res.status}` };
  }
  // Confirma que a instalação de fato materializou o toolchain (quando há `detect`).
  if (spec.detect && !isPresent(spec)) {
    return { id: spec.id, status: 'failed', error: 'instalador rodou mas o toolchain não foi detectado' };
  }
  return { id: spec.id, status: 'installed' };
}

export function createToolchainGateway(): ToolchainGateway {
  return {
    async ensure(spec: ToolchainSpec): Promise<EnsureResult> {
      return ensure(spec);
    },
  };
}
