import { test, expect } from 'bun:test';
import { toolDefinitions } from './index.js';
import * as langReference from './lang-reference.js';
import * as langRecipe from './lang-recipe.js';

/**
 * Nome de tool MCP é **contrato público** (§4.6 da auditoria) — Cowork/Codex e
 * qualquer cliente MCP referenciam por nome. Este snapshot trava a lista: um
 * rename acidental quebra o teste e força a mudança a ser intencional (atualizar
 * o array abaixo aparece no diff do PR).
 *
 * Formato exigido pelos clientes: `^[a-zA-Z0-9_-]{1,64}$`, minúsculas/dígitos,
 * termina com o verbo (sem `_` no fim). Prefixo `nio_` (CLI) — ver `brand.ts`.
 */

// Servidor `nio-cli` (src/mcp-server.ts)
const NIO_CLI_TOOLS = [
  'nio_delegate_exec',
  'nio_env_detect_deps',
  'nio_env_materialize',
  'nio_exec_status',
  'nio_plan',
  'nio_profile_get',
  'nio_session_activate',
  'nio_session_create',
  'nio_session_list',
  'nio_validate_plan',
];

// Servidor `nio-lang` (src/mcp-server-lang.ts)
const NIO_LANG_TOOLS = ['nio_lang_recipe', 'nio_lang_reference'];

test('nomes das tools MCP do nio-cli — snapshot (contrato público)', () => {
  const names = toolDefinitions.map((t) => t.name).sort();
  expect(names).toEqual(NIO_CLI_TOOLS);
});

test('nomes das tools MCP do nio-lang — snapshot', () => {
  const names = [langRecipe.definition.name, langReference.definition.name].sort();
  expect(names).toEqual(NIO_LANG_TOOLS);
});

test('todo nome de tool bate o formato aceito pelos clientes MCP', () => {
  for (const name of [...NIO_CLI_TOOLS, ...NIO_LANG_TOOLS]) {
    expect(name).toMatch(/^[a-z][a-z0-9_]{0,62}[a-z0-9]$/);
    expect(name.startsWith('nio_')).toBe(true);
  }
});
