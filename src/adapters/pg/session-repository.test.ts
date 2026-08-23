import { describe, expect, test } from 'bun:test';
import { mapSessionRow, type SessionRow } from './session-repository.js';

function row(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: 'a1b2c3d4-0000-4000-8000-000000000001',
    user_id: '7',
    name: 'meu-app',
    profile: 'fullstack',
    status: 'active',
    project_path: '~/projetos/meu-app',
    ide: 'vscode',
    config: { languages: ['typescript'] },
    created_at: new Date('2026-08-23T10:00:00Z'),
    updated_at: new Date('2026-08-23T11:00:00Z'),
    ...overrides,
  };
}

describe('mapSessionRow', () => {
  test('mapeia snake_case → camelCase e tipa enums', () => {
    const s = mapSessionRow(row());
    expect(s.id).toBe('a1b2c3d4-0000-4000-8000-000000000001');
    expect(s.userId).toBe(7);
    expect(s.profile).toBe('fullstack');
    expect(s.status).toBe('active');
    expect(s.projectPath).toBe('~/projetos/meu-app');
    expect(s.ide).toBe('vscode');
    expect(s.config.languages).toEqual(['typescript']);
    expect(s.createdAt).toEqual(new Date('2026-08-23T10:00:00Z'));
  });

  test('user_id BIGINT string vira number', () => {
    expect(mapSessionRow(row({ user_id: '42' })).userId).toBe(42);
  });

  test('config ausente/ilegível vira objeto vazio', () => {
    const empty = mapSessionRow(row({ config: undefined as unknown as Record<string, unknown> }));
    expect(empty.config).toEqual({});
  });

  test('preserva status archived e ide terminal', () => {
    const s = mapSessionRow(row({ status: 'archived', ide: 'terminal' }));
    expect(s.status).toBe('archived');
    expect(s.ide).toBe('terminal');
  });
});
