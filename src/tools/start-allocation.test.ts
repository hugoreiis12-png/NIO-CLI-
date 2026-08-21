import { test, expect } from 'bun:test';
import { formatAllocationStatus } from './start-allocation.js';

test('formatAllocationStatus: nova alocação criada agora tem elapsed ~0 e already_active false', () => {
  const result = formatAllocationStatus({ id: 'a1', start_time: new Date().toISOString() }, false);
  expect(result.allocation_id).toBe('a1');
  expect(result.already_active).toBe(false);
  expect(result.elapsed_seconds).toBeGreaterThanOrEqual(0);
  expect(result.elapsed_seconds).toBeLessThan(5);
});

test('formatAllocationStatus: alocação já ativa (edge case) marca already_active true', () => {
  const result = formatAllocationStatus({ id: 'a1', start_time: '2020-01-01T00:00:00Z' }, true);
  expect(result.already_active).toBe(true);
  expect(result.elapsed_seconds).toBeGreaterThan(0);
});

test('formatAllocationStatus: mesmos dados de entrada reproduzem o mesmo id/start_time (no-op de transformação)', () => {
  const row = { id: 'a1', start_time: '2026-01-01T00:00:00Z' };
  const result = formatAllocationStatus(row, true);
  expect(result.allocation_id).toBe(row.id);
  expect(result.start_time).toBe(row.start_time);
});
