/**
 * Adapter `ide` — implementação do `IdeGateway` (`core/environment.ts`).
 * Abre o editor da sessão na pasta do projeto: mapeia o `Ide` num launcher CLI,
 * detecta o binário no PATH (via `--version`, SEM shell) e dispara **detached**
 * (`unref`) — o editor continua vivo depois que a CLI sai.
 *
 * **Nunca lança** (contrato do port): tudo vira um `status` no `OpenResult`.
 */
import { spawn, spawnSync } from 'node:child_process';
import type { Ide } from '../../core/session.js';
import type { IdeGateway, OpenResult } from '../../core/environment.js';

/**
 * Launcher CLI de cada IDE que a CLI sabe abrir. `null` = a sessão não tem editor
 * pra abrir (`terminal` = só terminal; `other` = editor desconhecido, sem binário
 * mapeável). Função pura — testável sem IO.
 */
export function resolveLauncher(ide: Ide): { binary: string } | null {
  switch (ide) {
    case 'vscode':
      return { binary: 'code' };
    case 'cursor':
      return { binary: 'cursor' };
    case 'terminal':
    case 'other':
      return null;
  }
}

/**
 * Candidatos de binário por plataforma. No Windows os launchers de editor são
 * shims `.cmd` — o spawn SEM shell não resolve `.cmd` sozinho, então tentamos
 * `<bin>.cmd` antes do nome cru (mantém `shell: false`, seguro contra injeção).
 */
function binaryCandidates(binary: string): string[] {
  return process.platform === 'win32' ? [`${binary}.cmd`, binary] : [binary];
}

/** Primeiro candidato que responde a `--version` (existe no PATH). `null` se nenhum. */
function detectBinary(binary: string): string | null {
  for (const candidate of binaryCandidates(binary)) {
    const res = spawnSync(candidate, ['--version'], { stdio: 'ignore', timeout: 5000 });
    // ENOENT → não está no PATH. Qualquer exit code (mesmo != 0) = existe.
    if (!res.error) return candidate;
  }
  return null;
}

export function createIdeGateway(): IdeGateway {
  return {
    async open(ide: Ide, projectPath: string): Promise<OpenResult> {
      const launcher = resolveLauncher(ide);
      if (!launcher) return { ide, status: 'skipped' };

      const binary = detectBinary(launcher.binary);
      if (!binary) {
        return {
          ide,
          status: 'unavailable',
          error: `"${launcher.binary}" não está no PATH (instale o comando de linha do editor)`,
        };
      }

      try {
        // Detached + unref + stdio ignore: o editor vira processo independente e
        // sobrevive ao término da CLI, sem prender o terminal.
        const child = spawn(binary, [projectPath], { detached: true, stdio: 'ignore' });
        // Swallow de um 'error' assíncrono (ex.: ENOENT tardio) pra não derrubar
        // a CLI — a detecção acima já confirmou o binário, isso é só rede de segurança.
        child.on('error', () => {});
        child.unref();
        return { ide, status: 'opened', binary };
      } catch (err) {
        return { ide, status: 'failed', binary, error: (err as Error).message };
      }
    },
  };
}
