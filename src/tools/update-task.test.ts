import { test, expect } from 'bun:test';
import { buildTaskPatch, diffIdSet, buildUpdateTaskResult } from './update-task.js';

const CURRENT = {
  title: 'Título antigo',
  description: 'Descrição antiga',
  status: 'todo',
  priority: 'low',
  type: 'task',
  sprint_id: 'sprint-1',
  end_date: '2026-01-01',
};

test('buildTaskPatch: monta patch + changes só com campos que mudaram', () => {
  const { patch, changes } = buildTaskPatch(
    CURRENT,
    { title: 'Título novo', priority: 'high' },
    undefined,
  );
  expect(patch).toEqual({ title: 'Título novo', priority: 'high' });
  expect(changes).toEqual([
    { field: 'title', old_value: 'Título antigo', new_value: 'Título novo' },
    { field: 'priority', old_value: 'low', new_value: 'high' },
  ]);
});

test('buildTaskPatch: campos undefined no input são ignorados (não viram patch)', () => {
  const { patch, changes } = buildTaskPatch(
    CURRENT,
    { title: undefined, description: undefined, status: 'doing' },
    undefined,
  );
  expect(patch).toEqual({ status: 'doing' });
  expect(changes).toEqual([{ field: 'status', old_value: 'todo', new_value: 'doing' }]);
});

test('buildTaskPatch: input idêntico ao current não gera patch nem changes', () => {
  const { patch, changes } = buildTaskPatch(
    CURRENT,
    {
      title: CURRENT.title,
      description: CURRENT.description,
      status: CURRENT.status,
      priority: CURRENT.priority,
      type: CURRENT.type,
      end_date: CURRENT.end_date,
    },
    CURRENT.sprint_id,
  );
  expect(patch).toEqual({});
  expect(changes).toEqual([]);
});

test('buildTaskPatch: sprint_id null remove a sprint e registra a mudança', () => {
  const { patch, changes } = buildTaskPatch(CURRENT, {}, null);
  expect(patch).toEqual({ sprint_id: null });
  expect(changes).toEqual([{ field: 'sprint_id', old_value: 'sprint-1', new_value: null }]);
});

test('diffIdSet: conjuntos diferentes marcam changed', () => {
  const result = diffIdSet(['a', 'b'], ['b', 'c']);
  expect(result.changed).toBe(true);
  expect(result.before).toEqual(['a', 'b']);
  expect(result.after).toEqual(['b', 'c']);
});

test('diffIdSet: arrays vazios não mudam nada', () => {
  const result = diffIdSet([], []);
  expect(result).toEqual({ before: [], after: [], changed: false });
});

test('diffIdSet: mesmos ids em ordem diferente não é mudança (no-op)', () => {
  const result = diffIdSet(['b', 'a', 'c'], ['c', 'a', 'b']);
  expect(result.changed).toBe(false);
  expect(result.before).toEqual(['a', 'b', 'c']);
  expect(result.after).toEqual(['a', 'b', 'c']);
});

const FINAL_TASK = {
  id: 't1',
  key: 'PROJ-1',
  title: 'Título',
  status: 'doing',
  priority: 'high',
  type: 'task',
  sprint_id: 'sprint-1',
  end_date: null,
  updated_at: '2026-01-02T00:00:00Z',
};

test('buildUpdateTaskResult: inclui changed_fields e flags true quando assignees/labels foram passados', () => {
  const result = buildUpdateTaskResult(
    FINAL_TASK,
    [{ field: 'status', old_value: 'todo', new_value: 'doing' }],
    { assignee_user_ids: ['u1'], label_ids: [] },
  );
  expect(result).toEqual({
    ...FINAL_TASK,
    changed_fields: ['status'],
    assignees_changed: true,
    labels_changed: true,
  });
});

test('buildUpdateTaskResult: assignee_user_ids/label_ids undefined vira flags false', () => {
  const result = buildUpdateTaskResult(FINAL_TASK, [], {});
  expect(result.assignees_changed).toBe(false);
  expect(result.labels_changed).toBe(false);
});

test('buildUpdateTaskResult: sem changes, changed_fields fica vazio (no-op)', () => {
  const result = buildUpdateTaskResult(FINAL_TASK, [], { assignee_user_ids: undefined, label_ids: undefined });
  expect(result.changed_fields).toEqual([]);
});
