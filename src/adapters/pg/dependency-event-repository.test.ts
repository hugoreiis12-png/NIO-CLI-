import { test, expect } from 'bun:test';
import { mapDependencyEventRow, type DependencyEventRow } from './dependency-event-repository.js';

test('mapDependencyEventRow: snake_case → camelCase, installed_at null preservado', () => {
  const row: DependencyEventRow = {
    id: 'e1',
    session_id: 's1',
    file_path: 'package.json',
    dependency_name: 'react',
    dependency_type: 'npm',
    detected_at: new Date('2026-08-26T00:00:00Z'),
    installed: false,
    installed_at: null,
  };
  expect(mapDependencyEventRow(row)).toEqual({
    id: 'e1',
    sessionId: 's1',
    filePath: 'package.json',
    dependencyName: 'react',
    dependencyType: 'npm',
    detectedAt: new Date('2026-08-26T00:00:00Z'),
    installed: false,
    installedAt: null,
  });
});
