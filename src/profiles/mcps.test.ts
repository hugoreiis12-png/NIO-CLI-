import { test, expect } from 'bun:test';
import { n8nMcp, nioLangMcp, postgresMcp, powerbiMcp } from './mcps.js';

test('n8nMcp: id e comando verificado (npx n8n-mcp)', () => {
  expect(n8nMcp.id).toBe('n8n');
  expect(n8nMcp.command).toEqual(['npx', '-y', 'n8n-mcp']);
  expect(n8nMcp.environment).toBeUndefined(); // roda sem auth p/ as tools de docs
});

test('specs base/perfil têm ids estáveis (contrato do opencode.json)', () => {
  expect(nioLangMcp.id).toBe('nio-lang');
  expect(postgresMcp.id).toBe('postgres');
  expect(powerbiMcp.id).toBe('powerbi-modeling');
});
