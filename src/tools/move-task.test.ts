import { test, expect } from 'bun:test';
import { buildMoveTaskResult } from './move-task.js';

test('buildMoveTaskResult: muda de status registra previous_status corretamente', () => {
  const result = buildMoveTaskResult({ key: 'PROJ-1', title: 'T', status: 'todo' }, 't1', 'doing');
  expect(result).toEqual({
    task_id: 't1',
    key: 'PROJ-1',
    title: 'T',
    status: 'doing',
    previous_status: 'todo',
    already_in_status: false,
  });
});

test('buildMoveTaskResult: status vazio/inesperado (edge case) ainda é tratado como mudança', () => {
  const result = buildMoveTaskResult({ key: 'PROJ-1', title: 'T', status: '' }, 't1', 'todo');
  expect(result.already_in_status).toBe(false);
  expect(result.previous_status).toBe('');
});

test('buildMoveTaskResult: já no status alvo é no-op — previous_status repete o próprio status', () => {
  const result = buildMoveTaskResult({ key: 'PROJ-1', title: 'T', status: 'done' }, 't1', 'done');
  expect(result).toEqual({
    task_id: 't1',
    key: 'PROJ-1',
    title: 'T',
    status: 'done',
    previous_status: 'done',
    already_in_status: true,
  });
});
