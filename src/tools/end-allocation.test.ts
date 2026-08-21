import { test, expect } from 'bun:test';
import { formatEndAllocationResult } from './end-allocation.js';

test('formatEndAllocationResult: calcula duração e inclui contagem de task_allocations fechadas', () => {
  const result = formatEndAllocationResult(
    { id: 'a1', start_time: '2026-01-01T09:00:00Z', end_time: '2026-01-01T17:00:00Z' },
    3,
  );
  expect(result).toEqual({
    allocation_id: 'a1',
    start_time: '2026-01-01T09:00:00Z',
    end_time: '2026-01-01T17:00:00Z',
    duration_seconds: 8 * 3600,
    closed_task_allocations: 0 + 3,
  });
});

test('formatEndAllocationResult: nenhuma task_allocation aberta pra fechar (edge case) vira zero', () => {
  const result = formatEndAllocationResult(
    { id: 'a1', start_time: '2026-01-01T09:00:00Z', end_time: '2026-01-01T09:30:00Z' },
    0,
  );
  expect(result.closed_task_allocations).toBe(0);
});

test('formatEndAllocationResult: start === end dá duração zero (no-op temporal)', () => {
  const result = formatEndAllocationResult(
    { id: 'a1', start_time: '2026-01-01T09:00:00Z', end_time: '2026-01-01T09:00:00Z' },
    1,
  );
  expect(result.duration_seconds).toBe(0);
});
