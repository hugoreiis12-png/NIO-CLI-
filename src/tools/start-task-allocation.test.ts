import { test, expect } from 'bun:test';
import { buildClosedPreviousSummary, formatStartTaskAllocationResult } from './start-task-allocation.js';

test('buildClosedPreviousSummary: calcula a duração da task_allocation fechada', () => {
  const result = buildClosedPreviousSummary(
    { id: 'ta1', task_id: 't1' },
    { start_time: '2026-01-01T10:00:00Z', end_time: '2026-01-01T10:05:00Z' },
    'PROJ-1',
  );
  expect(result).toEqual({
    task_allocation_id: 'ta1',
    task_id: 't1',
    task_key: 'PROJ-1',
    duration_seconds: 300,
  });
});

test('buildClosedPreviousSummary: task anterior sem key (best-effort) vira null', () => {
  const result = buildClosedPreviousSummary(
    { id: 'ta1', task_id: 't1' },
    { start_time: '2026-01-01T10:00:00Z', end_time: '2026-01-01T10:00:10Z' },
    null,
  );
  expect(result.task_key).toBeNull();
});

test('buildClosedPreviousSummary: start === end dá duração zero (no-op temporal)', () => {
  const result = buildClosedPreviousSummary(
    { id: 'ta1', task_id: 't1' },
    { start_time: '2026-01-01T10:00:00Z', end_time: '2026-01-01T10:00:00Z' },
    'PROJ-1',
  );
  expect(result.duration_seconds).toBe(0);
});

test('formatStartTaskAllocationResult: monta payload com previous fechada', () => {
  const result = formatStartTaskAllocationResult(
    { id: 'ta2', start_time: '2026-01-01T11:00:00Z', is_overtime: false },
    { id: 't2', key: 'PROJ-2', title: 'Nova' },
    { task_allocation_id: 'ta1', task_id: 't1', task_key: 'PROJ-1', duration_seconds: 60 },
    false,
  );
  expect(result).toEqual({
    task_allocation_id: 'ta2',
    task: { id: 't2', key: 'PROJ-2', title: 'Nova' },
    started_at: '2026-01-01T11:00:00Z',
    is_overtime: false,
    closed_previous: { task_allocation_id: 'ta1', task_id: 't1', task_key: 'PROJ-1', duration_seconds: 60 },
    allocation_was_created: false,
  });
});

test('formatStartTaskAllocationResult: sem previous ativa, closed_previous fica null (edge case)', () => {
  const result = formatStartTaskAllocationResult(
    { id: 'ta1', start_time: '2026-01-01T09:00:00Z', is_overtime: true },
    { id: 't1', key: 'PROJ-1', title: 'Primeira' },
    null,
    true,
  );
  expect(result.closed_previous).toBeNull();
  expect(result.allocation_was_created).toBe(true);
});

test('formatStartTaskAllocationResult: allocation_was_created reflete exatamente o que foi passado (no-op de transformação)', () => {
  const result = formatStartTaskAllocationResult(
    { id: 'ta1', start_time: '2026-01-01T09:00:00Z', is_overtime: false },
    { id: 't1', key: 'PROJ-1', title: 'Primeira' },
    null,
    false,
  );
  expect(result.allocation_was_created).toBe(false);
});
