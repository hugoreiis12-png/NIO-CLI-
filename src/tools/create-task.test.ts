import { test, expect } from 'bun:test';
import { resolveTaskLinks, buildTaskInsertPayload, buildCreateTaskResult } from './create-task.js';

test('resolveTaskLinks: sem assignee explícito, usa o próprio usuário; junta repo atual + extras', () => {
  const result = resolveTaskLinks(
    { link_to_current_repository: true, additional_repository_ids: ['r2'] },
    'r1',
    'me',
  );
  expect(result).toEqual({ assigneeIds: ['me'], repoIds: ['r1', 'r2'] });
});

test('resolveTaskLinks: repositoryId ausente (edge case) não vincula repo atual', () => {
  const result = resolveTaskLinks(
    { link_to_current_repository: true, additional_repository_ids: [] },
    undefined,
    'me',
  );
  expect(result.repoIds).toEqual([]);
});

test('resolveTaskLinks: repo duplicado entre atual e extras não repete (no-op na dedup)', () => {
  const result = resolveTaskLinks(
    { link_to_current_repository: true, additional_repository_ids: ['r1', 'r1'] },
    'r1',
    'me',
  );
  expect(result.repoIds).toEqual(['r1']);
});

test('resolveTaskLinks: link_to_current_repository=false ignora o repo atual mesmo se existir', () => {
  const result = resolveTaskLinks(
    { link_to_current_repository: false, additional_repository_ids: [] },
    'r1',
    'me',
  );
  expect(result.repoIds).toEqual([]);
});

test('buildTaskInsertPayload: monta o insert com sprint resolvida e end_date default null', () => {
  const payload = buildTaskInsertPayload(
    { title: 'T', description: 'D', status: 'todo', priority: 'high', type: 'task' },
    'proj-1',
    'user-1',
    'sprint-1',
  );
  expect(payload).toEqual({
    title: 'T',
    description: 'D',
    status: 'todo',
    priority: 'high',
    type: 'task',
    project_id: 'proj-1',
    reporter_id: 'user-1',
    sprint_id: 'sprint-1',
    end_date: null,
  });
});

test('buildTaskInsertPayload: end_date ausente (edge case) vira null', () => {
  const payload = buildTaskInsertPayload(
    { title: 'T', description: '', status: 'todo', priority: 'none', type: 'task' },
    'proj-1',
    'user-1',
    null,
  );
  expect(payload.end_date).toBeNull();
  expect(payload.sprint_id).toBeNull();
});

const TASK = {
  id: 't1', key: 'PROJ-1', title: 'T', status: 'todo', priority: 'high',
  type: 'task', sprint_id: 'sprint-1', end_date: null, created_at: '2026-01-01',
};

test('buildCreateTaskResult: inclui vínculos e warnings quando há falhas parciais', () => {
  const result = buildCreateTaskResult(TASK, ['u1'], ['l1'], ['r1'], ['Falha ao vincular labels: boom']);
  expect(result).toEqual({
    ...TASK,
    linked: { assignee_user_ids: ['u1'], label_ids: ['l1'], repository_ids: ['r1'] },
    warnings: ['Falha ao vincular labels: boom'],
  });
});

test('buildCreateTaskResult: sem warnings (caso feliz), warnings vira undefined (no-op)', () => {
  const result = buildCreateTaskResult(TASK, ['u1'], [], [], []);
  expect(result.warnings).toBeUndefined();
});
