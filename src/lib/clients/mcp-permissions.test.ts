import { test, expect } from 'bun:test';
import { mcpAskRules, withMcpAskRules, hasMissingAskRules } from './mcp-permissions.js';
import { n8nMcp, n8nNativeMcp, nioLangMcp, postgresMcp } from '../../profiles/mcps.js';

test('chave = <id do server>_<tool>; spec sem askTools não gera regra', () => {
  const rules = mcpAskRules([n8nMcp, postgresMcp, nioLangMcp, n8nNativeMcp]);
  expect(rules['n8n_n8n_delete_workflow']).toBe('ask');
  expect(rules['n8n_n8n_manage_credentials']).toBe('ask');
  expect(rules['nio-lang_nio_lang_n8n_write']).toBe('ask');
  expect(rules['n8n-native_*']).toBe('ask');
  expect(Object.keys(rules).some((k) => k.startsWith('postgres'))).toBe(false);
});

test('leitura e documentação do n8n-mcp NÃO pedem aprovação', () => {
  const rules = mcpAskRules([n8nMcp]);
  for (const t of [
    'search_nodes',
    'get_node',
    'validate_workflow',
    'n8n_get_workflow',
    'n8n_list_workflows',
  ]) {
    expect(rules[`n8n_${t}`]).toBeUndefined();
  }
});

test('só gera ask, nunca allow (ordem de curinga é ambígua)', () => {
  expect(new Set(Object.values(mcpAskRules([n8nMcp, nioLangMcp, n8nNativeMcp])))).toEqual(
    new Set(['ask']),
  );
});

test('a regra do usuário vence a nossa; as demais chaves ficam intactas', () => {
  const user = { bash: 'ask', n8n_n8n_delete_workflow: 'deny' };
  const out = withMcpAskRules(user, [n8nMcp]) as Record<string, string>;
  expect(out['n8n_n8n_delete_workflow']).toBe('deny');
  expect(out.bash).toBe('ask');
  expect(out['n8n_n8n_create_workflow']).toBe('ask');
});

test('permission em forma de string e specs sem askTools passam intactos; ausente vira só as regras', () => {
  expect(withMcpAskRules('allow', [n8nMcp])).toBe('allow');
  const base = { bash: 'ask' };
  expect(withMcpAskRules(base, [postgresMcp])).toBe(base);
  expect(withMcpAskRules(undefined, [nioLangMcp])).toEqual({
    'nio-lang_nio_lang_n8n_write': 'ask',
  });
});

test('hasMissingAskRules: detecta config antigo sem as regras e reconhece o já migrado', () => {
  expect(hasMissingAskRules({ bash: 'ask' }, [n8nMcp])).toBe(true);
  expect(hasMissingAskRules(withMcpAskRules({ bash: 'ask' }, [n8nMcp]), [n8nMcp])).toBe(false);
  expect(hasMissingAskRules('allow', [n8nMcp])).toBe(false);
});

test('n8n-mcp: nenhum segredo no environment (não apaga nem grava a chave do shell)', () => {
  expect(Object.keys(n8nMcp.environment ?? {}).sort()).toEqual(['LOG_LEVEL', 'MCP_MODE']);
  expect(JSON.stringify(n8nNativeMcp)).not.toMatch(/Bearer [A-Za-z0-9]{8,}/);
  expect(n8nNativeMcp.headers?.Authorization).toBe('Bearer {env:N8N_NATIVE_MCP_TOKEN}');
});
