/**
 * Auto-install do projeto (fatia 4 do DependencyWatcher — Sprint 3). Roda o
 * instalador do ECOSSISTEMA no diretório do projeto (não pacote a pacote): um
 * `npm install` materializa tudo que o `package.json` declara. Isso zera injeção —
 * nenhum argumento vem do usuário, só um comando fixo por tipo, via `spawnSync`
 * SEM shell (mesma convenção de `dependency-install.ts`).
 *
 * NÃO confundir com `dependency-install.ts` (instala deps de skills declaradas no
 * frontmatter). Aqui é o manifest do projeto do usuário.
 */
import { spawnSyncPortable } from '../proc.js';
import type { DependencyType } from '../../core/types.js';
import type { InstallOutcome } from './dependencies.js';

/** Comando fixo do instalador por ecossistema. `null` = sem auto-install suportado. */
function installerFor(type: DependencyType): { program: string; args: string[] } | null {
  switch (type) {
    case 'npm':
      return { program: 'npm', args: ['install'] };
    case 'pip':
      return { program: 'pip', args: ['install', '-r', 'requirements.txt'] };
    case 'cargo':
      return { program: 'cargo', args: ['fetch'] };
    default:
      return null; // gem/composer/unknown ainda não automatizados
  }
}

/**
 * Instala as dependências declaradas do ecossistema `type` no `projectPath`.
 * `spawnSync` no `cwd` do projeto, args fixos em array, sem shell. Nunca lança —
 * falha vira `InstallOutcome { ok: false }`.
 */
export function installProjectDeps(type: DependencyType, projectPath: string): InstallOutcome {
  const installer = installerFor(type);
  if (!installer) {
    return { ok: false, code: null, error: `sem instalador automático para "${type}"` };
  }
  const res = spawnSyncPortable(installer.program, installer.args, {
    cwd: projectPath,
    stdio: 'inherit',
  });
  if (res.error) return { ok: false, code: null, error: res.error.message };
  return { ok: res.status === 0, code: res.status };
}
