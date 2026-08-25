import { test, expect } from 'bun:test';
import { createPackageMap } from './package-map.js';

test('resolve: mapeado devolve o pacote; não-mapeado devolve null', () => {
  const m = createPackageMap();
  expect(m.resolve('typescript', 'Next.js')).toBe('next');
  expect(m.resolve('node', 'Prisma')).toBe('prisma');
  expect(m.resolve('python', 'FastAPI')).toBe('fastapi');
  expect(m.resolve('csharp', 'Dapper')).toBe('Dapper');

  expect(m.resolve('typescript', 'FrameworkQueNãoExiste')).toBeNull();
  expect(m.resolve('n8n', 'qualquer')).toBeNull();
});
