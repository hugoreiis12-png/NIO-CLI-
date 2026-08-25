import { test, expect } from 'bun:test';
import { createLanguageCatalog } from './language-catalog.js';
import type { LanguageId } from '../../core/lang.js';

const ALL: LanguageId[] = ['python', 'typescript', 'node', 'csharp', 'n8n'];

test('os 5 recipes resolvem, batem o próprio language e têm packageManagers', () => {
  const cat = createLanguageCatalog();
  for (const l of ALL) {
    const r = cat.recipe(l);
    expect(r.language).toBe(l);
    expect(r.packageManagers.length).toBeGreaterThan(0);
  }
});

test('typescript expõe frameworks/ORMs e o SDK de MCP', () => {
  const ts = createLanguageCatalog().recipe('typescript');
  expect(ts.frameworks).toContain('Next.js');
  expect(ts.orms).toContain('Prisma');
  expect(ts.mcpSdk).toBe('@modelcontextprotocol/sdk');
});

test('linguagem sem recipe lança erro claro', () => {
  const cat = createLanguageCatalog();
  expect(() => cat.recipe('cobol' as LanguageId)).toThrow(/ainda não tem recipe/);
});
