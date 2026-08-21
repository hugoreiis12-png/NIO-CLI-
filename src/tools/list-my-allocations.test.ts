import { test, expect } from 'bun:test';
import { aggregateSegmentsByAllocation, formatAllocationList } from './list-my-allocations.js';

test('aggregateSegmentsByAllocation: soma contagem e segundos rastreados por allocation', () => {
  const rows = [
    { allocation_id: 'a1', start_time: '2026-01-01T09:00:00Z', end_time: '2026-01-01T09:10:00Z' },
    { allocation_id: 'a1', start_time: '2026-01-01T10:00:00Z', end_time: '2026-01-01T10:05:00Z' },
    { allocation_id: 'a2', start_time: '2026-01-01T09:00:00Z', end_time: '2026-01-01T09:01:00Z' },
  ];
  const result = aggregateSegmentsByAllocation(rows);
  expect(result.get('a1')).toEqual({ count: 2, tracked_seconds: 900 });
  expect(result.get('a2')).toEqual({ count: 1, tracked_seconds: 60 });
});

test('aggregateSegmentsByAllocation: array vazio (edge case) retorna mapa vazio', () => {
  const result = aggregateSegmentsByAllocation([]);
  expect(result.size).toBe(0);
});

test('aggregateSegmentsByAllocation: segmento com duração zero não quebra a agregação (no-op de tempo)', () => {
  const result = aggregateSegmentsByAllocation([
    { allocation_id: 'a1', start_time: '2026-01-01T09:00:00Z', end_time: '2026-01-01T09:00:00Z' },
  ]);
  expect(result.get('a1')).toEqual({ count: 1, tracked_seconds: 0 });
});

const ALLOCATIONS = [
  { id: 'a1', start_time: '2026-01-01T09:00:00Z', end_time: '2026-01-01T09:10:00Z', auto_closed: false },
  { id: 'a2', start_time: '2026-01-02T09:00:00Z', end_time: '2026-01-02T17:00:00Z', auto_closed: true },
];

test('formatAllocationList: embute a agregação de cada allocation no resultado', () => {
  const agg = new Map([['a1', { count: 3, tracked_seconds: 500 }]]);
  const result = formatAllocationList(ALLOCATIONS, agg);
  expect(result[0]).toEqual({
    id: 'a1', start_time: '2026-01-01T09:00:00Z', end_time: '2026-01-01T09:10:00Z',
    duration_seconds: 600, auto_closed: false, task_count: 3, tracked_seconds: 500,
  });
});

test('formatAllocationList: allocation sem segmentos agregados (edge case) vira zeros', () => {
  const result = formatAllocationList([ALLOCATIONS[1]], new Map());
  expect(result[0].task_count).toBe(0);
  expect(result[0].tracked_seconds).toBe(0);
});

test('formatAllocationList: lista vazia retorna lista vazia (no-op)', () => {
  expect(formatAllocationList([], new Map())).toEqual([]);
});
