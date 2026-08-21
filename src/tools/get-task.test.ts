import { test, expect } from 'bun:test';
import { collectRelatedIds, formatTaskDetail } from './get-task.js';

const EMPTY_ROWS = {
  assigneeRows: [],
  checklistRows: [],
  commentRows: [],
  historyRows: [],
  repoRows: [],
  labelRows: [],
};

test('collectRelatedIds: junta ids de assignees, comentários, histórico e reporter sem duplicar', () => {
  const rows = {
    ...EMPTY_ROWS,
    assigneeRows: [{ user_id: 'u1' }, { user_id: 'u2' }],
    commentRows: [{ id: 'c1', content: '', created_at: '', updated_at: '', author_id: 'u2' }],
    historyRows: [
      { id: 'h1', action: 'updated', field: null, old_value: null, new_value: null, created_at: '', user_id: 'u3' },
    ],
    repoRows: [{ repository_id: 'r1' }],
    labelRows: [{ label_id: 'l1' }],
  };
  const result = collectRelatedIds({ reporter_id: 'u1' }, rows);
  expect(result.userIds.sort()).toEqual(['u1', 'u2', 'u3']);
  expect(result.repoIds).toEqual(['r1']);
  expect(result.labelIds).toEqual(['l1']);
});

test('collectRelatedIds: sem relações, só o reporter aparece (edge case)', () => {
  const result = collectRelatedIds({ reporter_id: 'u1' }, EMPTY_ROWS);
  expect(result).toEqual({ userIds: ['u1'], repoIds: [], labelIds: [] });
});

test('collectRelatedIds: task sem nenhuma relação e reporter repetido em assignee não duplica (no-op)', () => {
  const rows = { ...EMPTY_ROWS, assigneeRows: [{ user_id: 'u1' }] };
  const result = collectRelatedIds({ reporter_id: 'u1' }, rows);
  expect(result.userIds).toEqual(['u1']);
});

const TASK = {
  id: 't1',
  key: 'PROJ-1',
  title: 'Título',
  description: 'Descrição',
  status: 'todo',
  priority: 'high',
  type: 'task',
  sprint_id: 'sprint-1',
  team: null,
  url: null,
  branch: null,
  start_date: null,
  end_date: null,
  reporter_id: 'u1',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
} as any;

const NO_REFS = { profiles: new Map(), reposById: new Map(), labelsById: new Map() };

test('formatTaskDetail: monta o payload completo resolvendo perfis, repos e labels', () => {
  const rows = {
    assigneeRows: [{ user_id: 'u2' }],
    checklistRows: [{ id: 'ck1', text: 'fazer', checked: false, order: 1 }],
    commentRows: [],
    historyRows: [],
    repoRows: [{ repository_id: 'r1' }],
    labelRows: [{ label_id: 'l1' }],
  };
  const refs = {
    profiles: new Map([['u2', { full_name: 'Fulano', username: 'fulano', avatar_url: null }]]),
    reposById: new Map([['r1', { name: 'repo', url: 'https://x', default_branch: 'main' }]]),
    labelsById: new Map([['l1', { name: 'bug', color: 'red' }]]),
  };
  const result = formatTaskDetail(TASK, rows, refs) as any;
  expect(result.task.id).toBe('t1');
  expect(result.assignees).toEqual([{ user_id: 'u2', full_name: 'Fulano', username: 'fulano', avatar_url: null }]);
  expect(result.checklist).toEqual([{ id: 'ck1', text: 'fazer', checked: false, order: 1 }]);
  expect(result.repositories).toEqual([{ id: 'r1', name: 'repo', url: 'https://x', default_branch: 'main' }]);
  expect(result.labels).toEqual([{ id: 'l1', name: 'bug', color: 'red' }]);
});

test('formatTaskDetail: refs não resolvidas (perfil/repo/label ausente) viram null', () => {
  const rows = {
    ...EMPTY_ROWS,
    assigneeRows: [{ user_id: 'ghost' }],
    repoRows: [{ repository_id: 'ghost-repo' }],
    labelRows: [{ label_id: 'ghost-label' }],
  };
  const result = formatTaskDetail(TASK, rows, NO_REFS) as any;
  expect(result.assignees).toEqual([{ user_id: 'ghost', full_name: null, username: null, avatar_url: null }]);
  expect(result.repositories).toEqual([{ id: 'ghost-repo', name: null, url: null, default_branch: null }]);
  expect(result.labels).toEqual([{ id: 'ghost-label', name: null, color: null }]);
});

test('formatTaskDetail: task sem nenhuma relação retorna listas vazias (no-op)', () => {
  const result = formatTaskDetail(TASK, EMPTY_ROWS, NO_REFS) as any;
  expect(result.assignees).toEqual([]);
  expect(result.checklist).toEqual([]);
  expect(result.comments).toEqual([]);
  expect(result.history).toEqual([]);
  expect(result.repositories).toEqual([]);
  expect(result.labels).toEqual([]);
});
