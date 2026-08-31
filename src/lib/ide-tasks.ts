/**
 * Task de auto-start do NIO na IDE. Em vez de abrir a IDE numa janela e o client
 * de IA noutra tela, o `nio init` grava um `.vscode/tasks.json` que roda `nio ai`
 * num terminal integrado quando a pasta abre (`runOn: folderOpen`). Vale pra
 * VS Code e Cursor (mesmo formato).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { backupFile, readJson, writeJson } from './file-merge.js';
import { ensureGitignored } from '../config.js';

const TASK_LABEL = 'NIO';

interface VscodeTask {
  label?: string;
  [k: string]: unknown;
}

/** A task que sobe o client. `nio ai` cuida do Headroom + handoff. */
function nioTask(): VscodeTask {
  return {
    label: TASK_LABEL,
    type: 'shell',
    command: 'nio ai',
    isBackground: true,
    problemMatcher: [],
    presentation: { reveal: 'always', panel: 'dedicated', focus: true, clear: true },
    runOptions: { runOn: 'folderOpen' },
  };
}

/** Merge não-destrutivo de `{ key: value }` num JSON de config. Retorna se criou o arquivo. */
function mergeJson(path: string, patch: (cur: Record<string, unknown>) => Record<string, unknown>): boolean {
  const created = !existsSync(path);
  const cur = created ? {} : ((readJson(path) as Record<string, unknown> | null) ?? {});
  if (!created) backupFile(path);
  writeJson(path, patch(cur));
  return created;
}

/**
 * Grava (merge) a task de auto-start em `<projectPath>/.vscode/`. Idempotente:
 * pula se a task `NIO` já existe. Gitignora os arquivos **só quando os cria**
 * (respeita um `.vscode/` que o time já versiona).
 */
export function writeIdeAutostartTask(projectPath: string): { created: boolean } {
  const dir = join(projectPath, '.vscode');
  const tasksPath = join(dir, 'tasks.json');
  const settingsPath = join(dir, 'settings.json');

  const createdTasks = mergeJson(tasksPath, (cur) => {
    const tasks = Array.isArray(cur.tasks) ? (cur.tasks as VscodeTask[]) : [];
    if (tasks.some((t) => t.label === TASK_LABEL)) return { version: '2.0.0', ...cur, tasks };
    return { version: '2.0.0', ...cur, tasks: [...tasks, nioTask()] };
  });

  mergeJson(settingsPath, (cur) => ({ ...cur, 'task.allowAutomaticTasks': 'on' }));

  // Só gitignora quando ESTE `.vscode/` nasceu agora (sem tasks.json antes). Se o
  // time já versiona `.vscode/`, não mexemos no `.gitignore` deles.
  if (createdTasks) {
    ensureGitignored('.vscode/tasks.json', projectPath);
    ensureGitignored('.vscode/settings.json', projectPath);
  }

  return { created: createdTasks };
}

/** Tira a task `NIO` do `tasks.json` (best-effort — pro `nio clean`). */
export function removeIdeAutostartTask(projectPath: string): void {
  const tasksPath = join(projectPath, '.vscode', 'tasks.json');
  if (!existsSync(tasksPath)) return;
  const cur = (readJson(tasksPath) as Record<string, unknown> | null) ?? {};
  const tasks = Array.isArray(cur.tasks) ? (cur.tasks as VscodeTask[]) : [];
  const kept = tasks.filter((t) => t.label !== TASK_LABEL);
  if (kept.length === tasks.length) return;
  backupFile(tasksPath);
  writeJson(tasksPath, { ...cur, tasks: kept });
}
