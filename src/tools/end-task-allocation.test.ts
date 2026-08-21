import { test, expect } from 'bun:test';
import { formatEndTaskAllocationResult } from './end-task-allocation.js';

test('formatEndTaskAllocationResult: monta payload com task resolvida e duração calculada', () => {
  const result = formatEndTaskAllocationResult(
    { id: 'ta1', start_time: '2026-01-01T09:00:00Z', end_time: '2026-01-01T09:30:00Z' },
    { id: 't1', key: 'PROJ-1', title: 'Título' },
  );
  expect(result).toEqual({
    task_allocation_id: 'ta1',
    task: { id: 't1', key: 'PROJ-1', title: 'Título' },
    start_time: '2026-01-01T09:00:00Z',
    end_time: '2026-01-01T09:30:00Z',
    duration_seconds: 1800,
  });
});

test('formatEndTaskAllocationResult: task não encontrada (edge case, best-effort) mantém key/title null', () => {
  const result = formatEndTaskAllocationResult(
    { id: 'ta1', start_time: '2026-01-01T09:00:00Z', end_time: '2026-01-01T09:05:00Z' },
    { id: 't1', key: null, title: null },
  );
  expect(result.task).toEqual({ id: 't1', key: null, title: null });
});

test('formatEndTaskAllocationResult: start === end dá duração zero (no-op temporal)', () => {
  const result = formatEndTaskAllocationResult(
    { id: 'ta1', start_time: '2026-01-01T09:00:00Z', end_time: '2026-01-01T09:00:00Z' },
    { id: 't1', key: 'PROJ-1', title: 'Título' },
  );
  expect(result.duration_seconds).toBe(0);
});
