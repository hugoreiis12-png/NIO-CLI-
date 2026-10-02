import { test, expect } from 'bun:test';
import { buildN8nNativeMcp, n8nNativeMcp, N8N_NATIVE_URL_ENV } from './mcps.js';
import {
  N8N_NATIVE_ID,
  N8N_NATIVE_READ_TOOLS,
  isN8nNativeReadTool,
  prefixedN8nNativeReadTools,
} from './n8n-native-tools.js';

test('sem detecção: askTools volta pro curinga — tudo pede aprovação', () => {
  expect(buildN8nNativeMcp().askTools).toEqual(['*']);
  expect(buildN8nNativeMcp([]).askTools).toEqual(['*']);
  expect(n8nNativeMcp.askTools).toEqual(['*']);
});

test('com detecção: leitura fica livre, escrita vai pra ask', () => {
  const spec = buildN8nNativeMcp([
    'search_workflows',
    'get_workflow_details',
    'execute_workflow',
    'publish_workflow',
    'delete_agent',
  ]);
  expect(spec.askTools).toEqual(['execute_workflow', 'publish_workflow', 'delete_agent']);
});

test('falha-fechado: tool desconhecida (lançada pelo n8n amanhã) cai em ask', () => {
  const spec = buildN8nNativeMcp(['search_workflows', 'tool_que_ainda_nao_existe']);
  expect(spec.askTools).toEqual(['tool_que_ainda_nao_existe']);
});

test('test_workflow é tratada como escrita — executa nodes sem pin data', () => {
  expect(isN8nNativeReadTool('test_workflow')).toBe(false);
  expect(buildN8nNativeMcp(['test_workflow']).askTools).toEqual(['test_workflow']);
});

test('só pede aprovação no que a instância realmente expõe', () => {
  const spec = buildN8nNativeMcp(['search_workflows', 'execute_workflow']);
  expect(spec.askTools).not.toContain('delete_agent');
});

test('o spec remoto não carrega segredo — só referência {env:…}', () => {
  const spec = buildN8nNativeMcp(['execute_workflow']);
  expect(spec.id).toBe(N8N_NATIVE_ID);
  expect(spec.url).toBe(`{env:${N8N_NATIVE_URL_ENV}}`);
  expect(spec.headers?.Authorization).toBe('Bearer {env:N8N_NATIVE_MCP_TOKEN}');
  expect(JSON.stringify(spec)).not.toMatch(/Bearer [A-Za-z0-9]{8,}/);
});

test('allowlist sem duplicata e com prefixo do server para o worker', () => {
  expect(new Set(N8N_NATIVE_READ_TOOLS).size).toBe(N8N_NATIVE_READ_TOOLS.length);
  const prefixed = prefixedN8nNativeReadTools();
  expect(prefixed).toHaveLength(N8N_NATIVE_READ_TOOLS.length);
  expect(prefixed).toContain('n8n-native_search_workflows');
  expect(prefixed.every((name) => name.startsWith(`${N8N_NATIVE_ID}_`))).toBe(true);
});
