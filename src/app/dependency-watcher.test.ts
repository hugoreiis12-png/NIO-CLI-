import { test, expect } from 'bun:test';
import { DependencyWatcher } from './dependency-watcher.js';
import type { DependencyEventRepository } from '../core/repositories.js';
import type { Session, DependencyEvent } from '../core/types.js';
import type { ScannedDependency } from '../lib/dependency-scan.js';

const session: Session = {
  id: 's1',
  userId: 1,
  name: 'demo',
  profile: 'fullstack',
  status: 'active',
  projectPath: '/proj',
  ide: 'vscode',
  config: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

/** Repo fake em memória — dedupe por session+file+name, registra markInstalled. */
function fakeRepo() {
  const events: DependencyEvent[] = [];
  const installed: string[] = [];
  let seq = 0;
  const repo: DependencyEventRepository = {
    async recordIfNew(input) {
      const found = events.find(
        (e) =>
          e.sessionId === input.sessionId &&
          e.filePath === input.filePath &&
          e.dependencyName === input.dependencyName,
      );
      if (found) return { event: found, created: false };
      const event: DependencyEvent = {
        id: `e${++seq}`,
        sessionId: input.sessionId,
        filePath: input.filePath,
        dependencyName: input.dependencyName,
        dependencyType: input.dependencyType,
        detectedAt: new Date(),
        installed: false,
        installedAt: null,
      };
      events.push(event);
      return { event, created: true };
    },
    async markInstalled(id) {
      installed.push(id);
    },
    async listBySession() {
      return events;
    },
  };
  return { repo, events, installed };
}

const scanned: ScannedDependency[] = [
  { name: 'react', type: 'npm', filePath: 'package.json' },
  { name: 'flask', type: 'pip', filePath: 'requirements.txt' },
];

test('tick sem autoInstall: registra faltantes, não instala; 2º tick não duplica', async () => {
  const { repo, events, installed } = fakeRepo();
  const watcher = new DependencyWatcher({
    repo,
    scan: () => scanned,
    installedCheck: () => false, // nada instalado
    install: () => {
      throw new Error('não deve instalar sem autoInstall');
    },
  });

  const first = await watcher.tick(session);
  expect(first.scanned).toBe(2);
  expect(first.recorded).toHaveLength(2);
  expect(first.installed).toEqual([]);
  expect(events).toHaveLength(2);

  const second = await watcher.tick(session);
  expect(second.recorded).toHaveLength(0); // dedupe
  expect(events).toHaveLength(2);
  expect(installed).toHaveLength(0);
});

test('tick com autoInstall: instala por ecossistema e marca instalado o que passou a existir', async () => {
  const { repo, installed } = fakeRepo();
  const installedTypes: string[] = [];
  // Antes de instalar: ausente. Depois que o install de um tipo roda: presente.
  const done = new Set<string>();
  const watcher = new DependencyWatcher({
    repo,
    autoInstall: true,
    scan: () => scanned,
    installedCheck: (dep) => done.has(dep.type),
    install: (type) => {
      installedTypes.push(type);
      done.add(type); // materializou
      return { ok: true, code: 0 };
    },
  });

  const result = await watcher.tick(session);
  expect(installedTypes.sort()).toEqual(['npm', 'pip']);
  expect(result.installed.sort()).toEqual(['npm', 'pip']);
  expect(installed).toHaveLength(2); // markInstalled p/ react e flask
});

test('tick com autoInstall mas install falha: não marca instalado', async () => {
  const { repo, installed } = fakeRepo();
  const watcher = new DependencyWatcher({
    repo,
    autoInstall: true,
    scan: () => scanned,
    installedCheck: () => false,
    install: () => ({ ok: false, code: 1, error: 'boom' }),
  });

  const result = await watcher.tick(session);
  expect(result.installed).toEqual([]);
  expect(installed).toHaveLength(0);
  expect(result.recorded).toHaveLength(2); // ainda registra a detecção
});
