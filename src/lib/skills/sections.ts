import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Seleção unificada de conteúdo por **role → área → stack**, com `general` em cascata.
 * Um só modelo dita skills, rules e dependencies — o que o usuário preenche no `init`
 * filtra os três igual.
 *
 * Taxonomia (uniforme nos kinds versionados):
 *   skills/core/<skill>/SKILL.md     (sem role — vai pra todo mundo)
 *   skills/<role>/<área|general>/<stack|general>/<skill>/SKILL.md
 *   rules/<role>/<área|general>/<stack|general>/rules.md
 *   dependencies/<role>/<área|general>/<stack|general>/*.md
 *   agents/<role>/<name>.md          (role, sem área/stack)
 *   commands/<name>.md  ·  hooks/*    (flat — sempre dev)
 *
 * Regra de inclusão: `core` entra sempre; fora dele, role selecionado, `general` do
 * role entra sempre, uma área só entra se selecionada, e dentro dela só o `general`
 * da área + o **stack escolhido**.
 */

export const GENERAL = 'general';
export const DEV_ROLE = 'dev';
/**
 * Seção sem role: vale para qualquer perfil. Antes de existir, `skills/core/*` caía
 * na checagem de role e era descartado em silêncio — o `senior-engineering-core`
 * estava no repo e não chegava a ninguém.
 */
export const CORE = 'core';

/** role(s) escolhidos + a stack de cada área selecionada (a área é a chave). */
export interface Selection {
  roles: string[];
  /** área → stack, ex.: `{ 'front-end': 'nextjs' }` (`'general'` = só o geral da área). */
  stacks: Record<string, string>;
}

/**
 * Roles = subpastas de topo de `skills/` (ex.: `dev`, `management`). `core` fica de
 * fora: não é perfil escolhível — sem isto ele apareceria como opção no `nio init`.
 */
export function discoverRoles(dir: string): string[] {
  return subdirs(join(dir, 'skills')).filter((r) => r !== CORE);
}

/** Áreas de um role = subpastas de `skills/<role>/` menos `general`. */
export function discoverAreas(dir: string, role: string): string[] {
  return subdirs(join(dir, 'skills', role)).filter((a) => a !== GENERAL);
}

/** Stacks de uma área = subpastas de `skills/<role>/<área>/` menos `general`. */
export function discoverStacks(dir: string, role: string, area: string): string[] {
  return subdirs(join(dir, 'skills', role, area)).filter((s) => s !== GENERAL);
}

function subdirs(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();
}

/**
 * Um path é incluído na seleção? Vale pra qualquer kind — aplica a gramática da taxonomia.
 * `commands`/`hooks` são flat e sempre-dev; `agents` filtra por role; `skills`/`rules`/
 * `dependencies` filtram por role → área → stack com `general` em cascata.
 */
export function includePath(relPath: string, sel: Selection): boolean {
  const parts = relPath.split('/');
  const kind = parts[0];

  if (kind === 'commands' || kind === 'hooks') return sel.roles.includes(DEV_ROLE);
  if (parts[1] === CORE) return true; // sem role: vale pra qualquer perfil

  const role = parts[1];
  if (!sel.roles.includes(role)) return false;
  if (kind === 'agents') return true; // role já bateu; agents não têm área/stack

  const seg2 = parts[2];
  if (seg2 === undefined || seg2 === GENERAL) return true; // geral do role
  if (!(seg2 in sel.stacks)) return false; // área não selecionada
  const seg3 = parts[3];
  return seg3 === GENERAL || seg3 === sel.stacks[seg2]; // geral da área ou stack escolhido
}

/** Filtra docs pela seleção. `undefined` → tudo (sem filtro). */
export function filterForSelection<T extends { relPath: string }>(
  docs: T[],
  sel: Selection | undefined,
): T[] {
  if (!sel) return docs;
  return docs.filter((d) => includePath(d.relPath, sel));
}

/**
 * Achata os segmentos de taxonomia pro layout on-disk do cliente:
 *   skills/core/<skill>/…                      → skills/<skill>/…
 *   skills/<role>/general/<skill>/…            → skills/<skill>/…
 *   skills/<role>/<área>/<stack>/<skill>/…      → skills/<skill>/…
 *   agents/<role>/<name>                        → agents/<name>
 *   commands/<name>  ·  hooks/*                  → inalterado (já flat)
 */
export function flattenSelection<T extends { relPath: string }>(docs: T[]): T[] {
  return docs.map((d) => {
    const parts = d.relPath.split('/');
    const kind = parts[0];
    if (kind === 'agents') return { ...d, relPath: `agents/${parts.slice(2).join('/')}` };
    if (kind === 'skills') {
      // `core` tem um nível a menos (não tem role/área/stack) — usar o slice dos
      // outros ramos comeria o nome da skill e colapsaria tudo em `skills/SKILL.md`.
      const rest =
        parts[1] === CORE ? parts.slice(2) : parts[2] === GENERAL ? parts.slice(3) : parts.slice(4);
      return { ...d, relPath: `skills/${rest.join('/')}` };
    }
    return d;
  });
}
