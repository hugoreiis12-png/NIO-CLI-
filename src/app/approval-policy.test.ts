/**
 * A política é o único ponto entre "o modelo pediu uma ferramenta" e "a
 * ferramenta rodou sem ninguém olhando". Os testes de escape valem mais que os
 * de caminho feliz.
 */
import { test, expect } from 'bun:test';
import { createApprovalPolicy, globParaRegex, casaAlgum } from './approval-policy.js';
import { createProfileCatalog } from '../profiles/index.js';

test('glob: `*` é curinga, o resto é literal', () => {
  expect(globParaRegex('nio_fabric_*').test('nio_fabric_query')).toBe(true);
  expect(globParaRegex('nio_fabric_*').test('nio_fabric_')).toBe(true);
  // Sem ancorar no fim, `read` casaria com `readFileAndDelete`.
  expect(globParaRegex('read').test('read')).toBe(true);
  expect(globParaRegex('read').test('read_write')).toBe(false);
  // Sem ancorar no início, `bash` casaria com `sudo_bash`.
  expect(globParaRegex('bash').test('evil_bash')).toBe(false);
});

test('SEGURANÇA: ponto do padrão não vira curinga', () => {
  // `.` sem escapar casaria qualquer caractere — `nio.fabric` liberaria
  // `nio_fabric`, e um padrão mal escrito viraria permissão larga em silêncio.
  expect(globParaRegex('nio.fabric').test('nio_fabric')).toBe(false);
  expect(globParaRegex('nio.fabric').test('nio.fabric')).toBe(true);
});

test('lista vazia não casa com nada', () => {
  expect(casaAlgum('read', [])).toBe(false);
});

test('perfil bi auto-aprova leitura de Fabric, mas não bash', () => {
  const policy = createApprovalPolicy();
  expect(policy.decide('nio_fabric_query', 'bi')).toBe('allow');
  expect(policy.decide('read', 'bi')).toBe('allow');
  // Escrita e shell exigem humano em TODO perfil — é o ponto da D2.
  expect(policy.decide('bash', 'bi')).toBe('park');
  expect(policy.decide('write', 'bi')).toBe('park');
  expect(policy.decide('edit', 'bi')).toBe('park');
});

test('perfil sem domínio analítico não herda as tools de Fabric', () => {
  const policy = createApprovalPolicy();
  expect(policy.decide('nio_fabric_query', 'qa')).toBe('park');
  expect(policy.decide('read', 'qa')).toBe('allow');
});

test('SEGURANÇA: nenhum dos 6 perfis auto-aprova escrita ou shell', () => {
  const policy = createApprovalPolicy();
  const perigosas = ['bash', 'write', 'edit', 'patch', 'webfetch'];
  for (const def of createProfileCatalog().list()) {
    for (const tool of perigosas) {
      // Se este teste quebrar, alguém alargou uma allowlist — justifique antes
      // de atualizar. É a única barreira entre um step headless e o disco.
      expect(`${def.profile}:${tool}:${policy.decide(tool, def.profile)}`).toBe(
        `${def.profile}:${tool}:park`,
      );
    }
  }
});

test('concessão pontual libera por nome EXATO, sem curinga', () => {
  const policy = createApprovalPolicy({ approved: ['bash'] });
  expect(policy.decide('bash', 'qa')).toBe('allow');
  // Aprovar `bash` não pode liberar `bash_sudo`: a concessão do humano foi
  // sobre uma tool nomeada, não sobre um prefixo.
  expect(policy.decide('bash_sudo', 'qa')).toBe('park');
  expect(policy.decide('write', 'qa')).toBe('park');
});

test('sem tool desconhecida passando por omissão', () => {
  const policy = createApprovalPolicy();
  expect(policy.decide('ferramenta_que_nao_existe', 'fullstack')).toBe('park');
});

test('n8n: leitura do MCP nativo roda livre no fullstack, escrita estaciona', () => {
  const policy = createApprovalPolicy();
  expect(policy.decide('n8n-native_search_workflows', 'fullstack')).toBe('allow');
  expect(policy.decide('n8n-native_get_workflow_details', 'fullstack')).toBe('allow');
  expect(policy.decide('nio_lang_n8n', 'fullstack')).toBe('allow');
  expect(policy.decide('n8n-native_execute_workflow', 'fullstack')).toBe('park');
  expect(policy.decide('n8n-native_test_workflow', 'fullstack')).toBe('park');
  expect(policy.decide('nio_lang_n8n_write', 'fullstack')).toBe('park');
});

test('n8n: tool nativa desconhecida estaciona (falha-fechado, sem curinga na allowlist)', () => {
  const policy = createApprovalPolicy();
  expect(policy.decide('n8n-native_get_tool_que_nao_existe', 'fullstack')).toBe('park');
  expect(policy.decide('n8n-native_delete_agent', 'fullstack')).toBe('park');
});

test('n8n não vaza para os outros perfis', () => {
  const policy = createApprovalPolicy();
  for (const profile of ['qa', 'bi', 'analyst', 'dba', 'scientist'] as const) {
    expect(policy.decide('n8n-native_search_workflows', profile)).toBe('park');
  }
});
