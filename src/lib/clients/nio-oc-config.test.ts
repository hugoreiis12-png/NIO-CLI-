import { test, expect } from 'bun:test';
import { excelMcp } from '../../profiles/mcps.js';
import { buildNioOpencodeConfig, profileModeledMcps } from './nio-oc-config.js';
import { NIO_OPERATOR_MODEL, NIO_AI_PROVIDER } from './client-configs.js';
import { createProfileCatalog } from '../../profiles/index.js';
import type { McpSpec } from '../../core/environment.js';

const powerbi: McpSpec = { id: 'powerbi-modeling', command: ['npx', '@microsoft/powerbi-modeling-mcp'] };

// global do usuário: MCPs pessoais (excel + lixo) + um provider próprio + shell validado.
const GLOBAL = {
  shell: 'powershell',
  instructions: ['CLAUDE.md'],
  provider: { anthropic: { options: { foo: 1 } } },
  mcp: {
    excel: { type: 'local', command: ['uvx', 'excel-mcp-server', 'stdio'], enabled: true },
    'powerbi-modeling-mcp': { type: 'local', command: ['x'], enabled: true }, // duplicado — deve sumir
    mermaid: { type: 'remote', url: 'https://x', enabled: true }, // lixo — deve sumir
    nio: { type: 'local', command: ['nio-cli'], enabled: true },
  },
};

test('buildNioOpencodeConfig: com NIO_PBI_LOCAL=1 o powerbi-modeling entra (conexão local declarada)', () => {
  const antes = process.env.NIO_PBI_LOCAL;
  process.env.NIO_PBI_LOCAL = '1';
  try {
    const cfg = buildNioOpencodeConfig(GLOBAL, [{ id: 'nio-lang', command: ['nio-lang'] }, powerbi], ['excel']);
    const mcp = cfg.mcp as Record<string, unknown>;
    expect(Object.keys(mcp).sort()).toEqual(['excel', 'nio', 'nio-lang', 'powerbi-modeling']);
  } finally {
    if (antes === undefined) delete process.env.NIO_PBI_LOCAL;
    else process.env.NIO_PBI_LOCAL = antes;
  }
});

test('buildNioOpencodeConfig: filtra o mcp pro conjunto do perfil, herda excel do global, força provider/model', () => {
  const cfg = buildNioOpencodeConfig(GLOBAL, [{ id: 'nio-lang', command: ['nio-lang'] }, powerbi], ['excel']);
  const mcp = cfg.mcp as Record<string, unknown>;

  // só nio + nio-lang + excel (herdado) — NADA do lixo do global.
  // powerbi-modeling fica DE FORA: ele serve só a conexão local e exige NIO_PBI_LOCAL=1.
  expect(Object.keys(mcp).sort()).toEqual(['excel', 'nio', 'nio-lang']);
  expect(mcp['powerbi-modeling']).toBeUndefined(); // sem declarar local, não sobe
  expect(mcp['powerbi-modeling-mcp']).toBeUndefined(); // duplicado fora
  expect(mcp.mermaid).toBeUndefined(); // lixo fora

  // excel copiado da def validada do global
  expect(mcp.excel).toEqual({ type: 'local', command: ['uvx', 'excel-mcp-server', 'stdio'], enabled: true });

  // provider/model forçados pro NIO (nio-local), não o provider do global
  expect(cfg.model).toBe(NIO_OPERATOR_MODEL);
  expect((cfg.provider as Record<string, unknown>)[NIO_AI_PROVIDER]).toBeDefined();
  expect((cfg.provider as Record<string, unknown>).anthropic).toBeUndefined();

  // herda settings validados do global
  expect(cfg.shell).toBe('powershell');
  // instructions: herda as do global + anexa a instrução do operador (pt-BR) por último
  const instr = cfg.instructions as string[];
  expect(instr[0]).toBe('CLAUDE.md');
  expect(instr[instr.length - 1]).toContain('nio-operator.md');
});

test('buildNioOpencodeConfig: semeia agentes-fork do NIO (subagent) e preserva os do global', () => {
  const cfg = buildNioOpencodeConfig(
    { agent: { meu: { mode: 'subagent', description: 'do usuário' } } },
    [{ id: 'nio-lang', command: ['nio-lang'] }],
    [],
  );
  const agent = cfg.agent as Record<string, Record<string, unknown>>;
  expect(agent['nio-scout']?.mode).toBe('subagent'); // fork do NIO presente
  expect(agent['nio-scout']?.permission).toEqual({ edit: 'deny', bash: 'deny', webfetch: 'deny' });
  expect(agent.meu?.description).toBe('do usuário'); // agente do usuário preservado
});

test('buildNioOpencodeConfig: id herdado ausente no global é ignorado (sem quebrar)', () => {
  const cfg = buildNioOpencodeConfig({ mcp: {} }, [{ id: 'nio-lang', command: ['nio-lang'] }], ['excel']);
  const mcp = cfg.mcp as Record<string, unknown>;
  expect(mcp.excel).toBeUndefined();
  expect(Object.keys(mcp).sort()).toEqual(['nio', 'nio-lang']);
});

test('profileModeledMcps: base (nio-lang) + os do perfil; qa não tem powerbi/excel', () => {
  const catalog = createProfileCatalog();
  const bi = profileModeledMcps(catalog.get('bi')).map((m) => m.id);
  expect(bi).toContain('nio-lang');
  expect(bi).toContain('powerbi-modeling');

  const qa = profileModeledMcps(catalog.get('qa')).map((m) => m.id);
  expect(qa).toEqual(['nio-lang']); // só a base
  expect(catalog.get('qa').inheritGlobalMcpIds ?? []).not.toContain('excel');
});

test('ACEITE: instrução com caminho inexistente é descartada (some em silêncio)', () => {
  // Medido em prod: o global apontava um ARCHITECT.md de um checkout antigo, e o
  // grounding de BI que se acreditava ativo nunca chegava ao modelo.
  const cfg = buildNioOpencodeConfig(
    { instructions: ['C:/nao/existe/ARCHITECT.md'] },
    [],
    [],
  );
  const instr = cfg.instructions as string[];
  expect(instr.some((p) => p.includes('nao/existe'))).toBe(false);
  expect(instr[instr.length - 1]).toContain('nio-operator.md'); // a do NIO continua por último
});

test('ACEITE: perfil pede excel e o global não tem → NIO usa a própria spec', () => {
  // Máquina nova: o perfil analytics lista `excel` em inheritGlobalMcpIds, ninguém
  // criava a entry, e ela sumia com um aviso. O NIO já modela o excel — use-o.
  const cfg = buildNioOpencodeConfig({}, [excelMcp], ['excel']);
  const mcp = cfg.mcp as Record<string, { command?: string[] }>;
  expect(mcp.excel?.command).toEqual(['uvx', 'excel-mcp-server', 'stdio']);
});

test('def do usuário no global vence a modelada (não sobrescreve configuração dele)', () => {
  const meu = { type: 'local', command: ['meu-excel'], enabled: true };
  const cfg = buildNioOpencodeConfig({ mcp: { excel: meu } }, [excelMcp], ['excel']);
  const mcp = cfg.mcp as Record<string, { command?: string[] }>;
  expect(mcp.excel?.command).toEqual(['meu-excel']);
});
