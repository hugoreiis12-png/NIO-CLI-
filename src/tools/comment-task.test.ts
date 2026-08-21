import { test, expect } from 'bun:test';
import { buildCommentHistoryEntry, buildCommentResult } from './comment-task.js';

test('buildCommentHistoryEntry: monta o registro de histórico com o conteúdo completo (< 200 chars)', () => {
  const entry = buildCommentHistoryEntry('t1', 'u1', 'comentário curto');
  expect(entry).toEqual({
    task_id: 't1',
    user_id: 'u1',
    action: 'commented',
    field: null,
    new_value: 'comentário curto',
  });
});

test('buildCommentHistoryEntry: comentário vazio (edge case) vira preview vazio', () => {
  const entry = buildCommentHistoryEntry('t1', 'u1', '');
  expect(entry.new_value).toBe('');
});

test('buildCommentHistoryEntry: comentário maior que 200 chars é truncado, resto vira no-op', () => {
  const long = 'a'.repeat(250);
  const entry = buildCommentHistoryEntry('t1', 'u1', long);
  expect(entry.new_value).toBe('a'.repeat(200));
  expect(entry.new_value.length).toBe(200);
});

test('buildCommentResult: monta o payload de resposta com os três campos', () => {
  const result = buildCommentResult({ id: 'c1', task_id: 't1', created_at: '2026-01-01T00:00:00Z' });
  expect(result).toEqual({ comment_id: 'c1', task_id: 't1', created_at: '2026-01-01T00:00:00Z' });
});

test('buildCommentResult: não inclui nenhum campo além dos três esperados (no excesso)', () => {
  const result = buildCommentResult({ id: 'c1', task_id: 't1', created_at: '2026-01-01T00:00:00Z' });
  expect(Object.keys(result).sort()).toEqual(['comment_id', 'created_at', 'task_id']);
});
