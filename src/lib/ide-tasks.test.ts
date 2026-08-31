import { test, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeIdeAutostartTask, removeIdeAutostartTask } from './ide-tasks.js';

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});
const mk = () => (dir = mkdtempSync(join(tmpdir(), 'nio-ide-')));
const tasks = () => JSON.parse(readFileSync(join(dir, '.vscode', 'tasks.json'), 'utf8'));

test('writeIdeAutostartTask: cria tasks.json + settings.json e gitignora quando cria', () => {
  mk();
  const r = writeIdeAutostartTask(dir);
  expect(r.created).toBe(true);

  const t = tasks();
  expect(t.version).toBe('2.0.0');
  expect(t.tasks[0].label).toBe('NIO');
  expect(t.tasks[0].command).toBe('nio ai');
  expect(t.tasks[0].runOptions.runOn).toBe('folderOpen');

  const s = JSON.parse(readFileSync(join(dir, '.vscode', 'settings.json'), 'utf8'));
  expect(s['task.allowAutomaticTasks']).toBe('on');

  const gi = readFileSync(join(dir, '.gitignore'), 'utf8');
  expect(gi).toContain('.vscode/tasks.json');
  expect(gi).toContain('.vscode/settings.json');
});

test('writeIdeAutostartTask: idempotente e preserva tasks existentes', () => {
  mk();
  mkdirSync(join(dir, '.vscode'));
  writeFileSync(
    join(dir, '.vscode', 'tasks.json'),
    JSON.stringify({ version: '2.0.0', tasks: [{ label: 'build', type: 'shell', command: 'make' }] }),
  );

  const r1 = writeIdeAutostartTask(dir);
  expect(r1.created).toBe(false); // já existia
  let t = tasks();
  expect(t.tasks.map((x: { label: string }) => x.label).sort()).toEqual(['NIO', 'build']);

  writeIdeAutostartTask(dir); // 2ª vez
  t = tasks();
  expect(t.tasks.filter((x: { label: string }) => x.label === 'NIO')).toHaveLength(1);

  // não existia → não gitignora um .vscode/ que o time pode versionar
  expect(existsSync(join(dir, '.gitignore'))).toBe(false);
});

test('removeIdeAutostartTask: tira só a task NIO', () => {
  mk();
  mkdirSync(join(dir, '.vscode'));
  writeFileSync(
    join(dir, '.vscode', 'tasks.json'),
    JSON.stringify({ version: '2.0.0', tasks: [{ label: 'build' }, { label: 'NIO' }] }),
  );
  removeIdeAutostartTask(dir);
  expect(tasks().tasks.map((x: { label: string }) => x.label)).toEqual(['build']);
});
