import { test, expect } from 'bun:test';
import { handler } from './list-tasks.js';
import type { ToolContext } from './index.js';
import type { Gateway } from '../core/ports.js';
import type { TaskListFilter, TaskListResult } from '../core/types.js';

const PROJECT_ID = '11111111-1111-1111-1111-111111111111';

// A prova do PoC: pra testar a tool basta um gateway fake — nenhum mock do
// dialeto `.from().select().eq()` do Supabase.
function ctxWith(
  listTasks: (f: TaskListFilter) => Promise<TaskListResult>,
): { ctx: ToolContext; calls: TaskListFilter[] } {
  const calls: TaskListFilter[] = [];
  const gateway: Gateway = {
    listTasks: (f) => {
      calls.push(f);
      return listTasks(f);
    },
  };
  const ctx: ToolContext = {
    gateway,
    user: { id: 'u1', email: 'a@b.c', full_name: null, username: null },
    config: { project_id: PROJECT_ID },
  };
  return { ctx, calls };
}

function parseJson(result: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(result.content[0].text);
}

test('handler: repassa filtros ao gateway e embrulha o resultado no envelope', async () => {
  const item = {
    id: 't1', key: 'P-1', title: 'A', status: 'todo', priority: 'high',
    type: 'task', sprint_id: null, end_date: null, created_at: '2026-01-01', assignees: [],
  };
  const { ctx, calls } = ctxWith(async () => ({ tasks: [item] }));

  const res = await handler({ status: ['todo'], assignee: 'me', limit: 10 }, ctx);
  const body = parseJson(res as never);

  expect(calls[0]).toMatchObject({
    projectId: PROJECT_ID,
    userId: 'u1',
    status: ['todo'],
    assignee: 'me',
    limit: 10,
    offset: 0,
  });
  expect(body).toEqual({ tasks: [item], count: 1, limit: 10, offset: 0 });
});

test('handler: erro do gateway vira errorResult (sem vazar exceção)', async () => {
  const { ctx } = ctxWith(async () => {
    throw new Error('Erro ao listar tarefas: boom');
  });

  const res = (await handler({}, ctx)) as { isError?: boolean; content: Array<{ text: string }> };
  expect(res.isError).toBe(true);
  expect(res.content[0].text).toBe('Erro ao listar tarefas: boom');
});

test('handler: note do gateway (ex.: sem sprint ativa) é propagada', async () => {
  const { ctx } = ctxWith(async () => ({ tasks: [], note: 'Não há sprint ativa neste projeto.' }));

  const body = parseJson((await handler({ sprint: 'active' }, ctx)) as never);
  expect(body).toEqual({
    tasks: [], count: 0, limit: 50, offset: 0, note: 'Não há sprint ativa neste projeto.',
  });
});

test('handler: argumento inválido não chega ao gateway', async () => {
  const { ctx, calls } = ctxWith(async () => ({ tasks: [] }));
  const res = (await handler({ limit: 999 }, ctx)) as { isError?: boolean };
  expect(res.isError).toBe(true);
  expect(calls).toHaveLength(0);
});
