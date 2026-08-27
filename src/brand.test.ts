import { test, expect } from 'bun:test';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { brand, patRegex, homePath, env, envName } from './brand.js';
import { toolDefinitions } from './tools/index.js';
import { PROJECT_CONFIG_FILE } from './constants.js';

// Trava os defaults: mudar qualquer um destes é um rebrand consciente, não um acidente.
test('defaults da marca reproduzem os valores atuais (NIO)', () => {
  expect(brand.name).toBe('nio');
  expect(brand.mcpBinName).toBe('nio-cli');
  expect(brand.mcpServerKey).toBe('nio');
  expect(brand.projectConfigFile).toBe('nio.json');
  expect(brand.homeDirName).toBe('.nio');
  expect(brand.envPrefix).toBe('NIO');
  expect(brand.patPrefix).toBe('nio_');
  expect(brand.toolPrefix).toBe('nos_');
  expect(brand.cliToolPrefix).toBe('nio_');
});

// Um prefixo com espaço/maiúscula gera nome de tool que os clientes MCP rejeitam —
// e a falha só apareceria em runtime, com a tool sumindo silenciosamente.
test('prefixos de tool têm formato aceito pelo MCP', () => {
  for (const p of [brand.toolPrefix, brand.cliToolPrefix]) {
    expect(p).toMatch(/^[a-z][a-z0-9]*_$/);
  }
});

test('as tools v2 estão registradas — só nio_, sem nos_ (v1 removido)', () => {
  const names = toolDefinitions.map((t) => t.name).sort();
  // As 16 tools v1 (nos_*, tasks/sprints/alocação) foram removidas na migração.
  // Sobram as 4 de execução + as tools de ambiente (Sprint 4).
  expect(names).toEqual(
    expect.arrayContaining([
      'nio_delegate_exec',
      'nio_exec_status',
      'nio_plan',
      'nio_validate_plan',
      'nio_profile_get',
      'nio_session_list',
      'nio_session_activate',
    ]),
  );
  for (const n of names) {
    expect(n).toMatch(/^nio_[a-z_]+$/); // nenhum nome torto e nenhum nos_ sobrando
    expect(n).not.toContain('__');
  }
});

test('constants derivados batem com os caminhos atuais', () => {
  expect(PROJECT_CONFIG_FILE).toBe('nio.json');
});

test('patRegex aceita o formato NIO e rejeita o resto', () => {
  expect(patRegex.test('nio_' + 'a'.repeat(64))).toBe(true);
  expect(patRegex.test('nio_' + 'A'.repeat(64))).toBe(false); // só hex minúsculo
  expect(patRegex.test('nio_abc')).toBe(false);
  expect(patRegex.test('xxx_' + 'a'.repeat(64))).toBe(false);
  expect(patRegex.test('noc_' + 'a'.repeat(64))).toBe(false); // prefixo antigo não é mais aceito
});

test('helpers de env e path compõem com o prefixo', () => {
  expect(envName('CLIENT')).toBe('NIO_CLIENT');
  expect(homePath('skills')).toBe(join(homedir(), '.nio', 'skills'));

  process.env.NIO_CLIENT = 'cowork';
  expect(env('CLIENT')).toBe('cowork');
  delete process.env.NIO_CLIENT;
  expect(env('CLIENT')).toBeUndefined();
});
