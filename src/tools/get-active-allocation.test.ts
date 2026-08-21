import { test, expect } from 'bun:test';
import { formatActiveAllocation } from './get-active-allocation.js';

const ALLOCATION = { id: 'a1', start_time: '2026-01-01T09:00:00Z' };
const TASKS_BY_ID = new Map([['t1', { key: 'PROJ-1', title: 'Título', project_id: 'p1' }]]);
const PROJECTS_BY_ID = new Map([['p1', 'Projeto X']]);

test('formatActiveAllocation: monta segmentos + task ativa (segmento sem end_time)', () => {
  const segments = [
    { id: 's1', task_id: 't1', start_time: '2026-01-01T09:00:00Z', end_time: '2026-01-01T09:10:00Z', is_overtime: false },
    { id: 's2', task_id: 't1', start_time: '2026-01-01T09:10:00Z', end_time: null, is_overtime: false },
  ];
  const result = formatActiveAllocation(ALLOCATION, segments, TASKS_BY_ID, PROJECTS_BY_ID) as any;
  expect(result.segments).toHaveLength(2);
  expect(result.segments[0].duration_seconds).toBe(600);
  expect(result.active_task.task_allocation_id).toBe('s2');
  expect(result.active_task.task).toEqual({ id: 't1', key: 'PROJ-1', title: 'Título', project_name: 'Projeto X' });
  // total_seconds_today soma o segmento fechado + o ativo (elapsed até agora) — só garantimos o piso.
  expect(result.total_seconds_today).toBeGreaterThanOrEqual(600);
});

test('formatActiveAllocation: task não resolvida (edge case) vira campos null', () => {
  const segments = [{ id: 's1', task_id: 'ghost', start_time: '2026-01-01T09:00:00Z', end_time: null, is_overtime: false }];
  const result = formatActiveAllocation(ALLOCATION, segments, new Map(), new Map()) as any;
  expect(result.active_task.task).toEqual({ id: 'ghost', key: null, title: null, project_name: null });
});

test('formatActiveAllocation: sem segmentos, active_task fica null e total é zero (no-op)', () => {
  const result = formatActiveAllocation(ALLOCATION, [], TASKS_BY_ID, PROJECTS_BY_ID) as any;
  expect(result.segments).toEqual([]);
  expect(result.active_task).toBeNull();
  expect(result.total_seconds_today).toBe(0);
});

test('formatActiveAllocation: todos os segmentos fechados (nenhum ativo) também vira active_task null', () => {
  const segments = [
    { id: 's1', task_id: 't1', start_time: '2026-01-01T09:00:00Z', end_time: '2026-01-01T09:05:00Z', is_overtime: false },
  ];
  const result = formatActiveAllocation(ALLOCATION, segments, TASKS_BY_ID, PROJECTS_BY_ID) as any;
  expect(result.active_task).toBeNull();
  expect(result.total_seconds_today).toBe(300);
});
