import { test, expect } from 'bun:test';
import { groupAssigneesByTask, formatTaskList } from './task-gateway.js';

test('groupAssigneesByTask: agrupa múltiplos assignees por task, resolvendo perfil', () => {
  const rows = [
    { task_id: 't1', user_id: 'u1' },
    { task_id: 't1', user_id: 'u2' },
    { task_id: 't2', user_id: 'u1' },
  ];
  const profiles = new Map([
    ['u1', { full_name: 'Ana', username: 'ana' }],
    ['u2', { full_name: 'Beto', username: 'beto' }],
  ]);
  const result = groupAssigneesByTask(rows, profiles);
  expect(result.get('t1')).toEqual([
    { user_id: 'u1', full_name: 'Ana', username: 'ana' },
    { user_id: 'u2', full_name: 'Beto', username: 'beto' },
  ]);
  expect(result.get('t2')).toEqual([{ user_id: 'u1', full_name: 'Ana', username: 'ana' }]);
});

test('groupAssigneesByTask: perfil ausente vira null (edge case)', () => {
  const result = groupAssigneesByTask([{ task_id: 't1', user_id: 'ghost' }], new Map());
  expect(result.get('t1')).toEqual([{ user_id: 'ghost', full_name: null, username: null }]);
});

test('groupAssigneesByTask: sem assignees, mapa fica vazio (no-op)', () => {
  const result = groupAssigneesByTask([], new Map());
  expect(result.size).toBe(0);
});

const TASKS = [
  { id: 't1', key: 'PROJ-1', title: 'A', status: 'todo', priority: 'high', type: 'task', sprint_id: 's1', end_date: null, created_at: '2026-01-01' },
  { id: 't2', key: 'PROJ-2', title: 'B', status: 'doing', priority: 'low', type: 'bug', sprint_id: null, end_date: '2026-02-01', created_at: '2026-01-02' },
];

test('formatTaskList: embute os assignees de cada task no resultado', () => {
  const assigneesByTask = new Map([['t1', [{ user_id: 'u1', full_name: 'Ana', username: 'ana' }]]]);
  const result = formatTaskList(TASKS, assigneesByTask);
  expect(result[0]).toEqual({ ...TASKS[0], assignees: [{ user_id: 'u1', full_name: 'Ana', username: 'ana' }] });
  expect(result[1]).toEqual({ ...TASKS[1], assignees: [] });
});

test('formatTaskList: task sem entrada no mapa de assignees vira lista vazia (edge case)', () => {
  const result = formatTaskList([TASKS[0]], new Map());
  expect(result[0].assignees).toEqual([]);
});

test('formatTaskList: lista de tasks vazia retorna lista vazia (no-op)', () => {
  expect(formatTaskList([], new Map())).toEqual([]);
});
