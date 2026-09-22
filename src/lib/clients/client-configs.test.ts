import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  planOpencodeUpdate,
  planNioAiProvider,
  upsertOpencodeMcp,
  installOpencodeGlobal,
  NIO_OPERATOR_MODEL,
  NIO_AI_BASE_URL,
  NIO_AI_PROVIDER,
  NIO_AI_MODEL_ID,
  NIO_AI_CONTEXT,
  contextConfigWarning,
  compactionReserved,
} from './client-configs.js';
import type { McpSpec } from '../../core/environment.js';

const NIO_ENTRY = { command: ['nio-cli'], environment: {} as Record<string, string> };
const PG_MCP: McpSpec = {
  id: 'postgres',
  command: ['npx', '-y', '@modelcontextprotocol/server-postgres'],
  environment: { DATABASE_URL: 'x' },
};

test('planOpencodeUpdate: grava model + mcp.nio + MCPs do perfil num config vazio', () => {
  const { next } = planOpencodeUpdate({}, NIO_ENTRY, [PG_MCP]);
  expect(next.model).toBe(NIO_OPERATOR_MODEL);
  const mcp = next.mcp as any;
  expect(mcp.nio.command).toEqual(['nio-cli']);
  expect(mcp.postgres.command).toEqual(PG_MCP.command);
  expect(mcp.postgres.enabled).toBe(true);
});

test('planNioAiProvider: cria provider dedicado (npm openai-compatible + baseURL + modelo/limite), preserva o resto', () => {
  const out = planNioAiProvider(
    { model: 'x', provider: { anthropic: { options: { foo: 1 } } } },
    'nio-local',
    'http://192.168.0.140:8001/v1',
    'RedHatAI/Qwen3.8-27B-INT4',
    65536,
    20000,
  );
  const p = out.provider as Record<string, any>;
  expect(p['nio-local'].npm).toBe('@ai-sdk/openai-compatible');
  expect(p['nio-local'].options.baseURL).toBe('http://192.168.0.140:8001/v1');
  expect(p['nio-local'].models['RedHatAI/Qwen3.8-27B-INT4'].limit).toEqual({ context: 65536, output: 20000 });
  expect(p.anthropic.options.foo).toBe(1); // não mexeu noutro provider
  expect(out.model).toBe('x');
});

test('planOpencodeUpdate: com baseURL → semeia o provider dedicado, NÃO toca o opencode, alreadyConfigured idempotente', () => {
  const url = 'http://192.168.0.140:8001/v1';
  const first = planOpencodeUpdate({}, NIO_ENTRY, [], url);
  const p = first.next.provider as Record<string, any>;
  expect(p[NIO_AI_PROVIDER].options.baseURL).toBe(url);
  // Janela REAL do provider (NIO_AI_CONTEXT) — sub-declarar causava loop de compactação.
  expect(p[NIO_AI_PROVIDER].models[NIO_AI_MODEL_ID].limit.context).toBe(NIO_AI_CONTEXT);
  expect(p.opencode).toBeUndefined(); // opencode fica no default, sem hijack

  const seeded = first.next;
  expect(planOpencodeUpdate(seeded, NIO_ENTRY, [], url).alreadyConfigured).toBe(true);
  expect(planOpencodeUpdate(seeded, NIO_ENTRY, [], 'http://other/v1').alreadyConfigured).toBe(false);
});

test('planOpencodeUpdate: idempotente — rodar sobre o próprio resultado marca alreadyConfigured', () => {
  const { next } = planOpencodeUpdate({}, NIO_ENTRY, [PG_MCP]);
  const again = planOpencodeUpdate(next, NIO_ENTRY, [PG_MCP]);
  expect(again.alreadyConfigured).toBe(true);
});

test('planOpencodeUpdate: MCP do perfil ausente → não está configurado ainda', () => {
  const semPerfil = planOpencodeUpdate({}, NIO_ENTRY, []).next;
  const { alreadyConfigured } = planOpencodeUpdate(semPerfil, NIO_ENTRY, [PG_MCP]);
  expect(alreadyConfigured).toBe(false);
});

test('planOpencodeUpdate: preserva mcp.nio e chaves não-nio do usuário', () => {
  const existing = {
    theme: 'dark',
    mcp: { custom: { type: 'local', command: ['meu-mcp'], enabled: true } },
  };
  const { next } = planOpencodeUpdate(existing, NIO_ENTRY, [PG_MCP]);
  expect(next.theme).toBe('dark');
  const mcp = next.mcp as any;
  expect(mcp.custom.command).toEqual(['meu-mcp']); // chave do usuário intacta
  expect(mcp.nio.command).toEqual(['nio-cli']);
  expect(mcp.postgres.command).toEqual(PG_MCP.command);
});

test('installOpencodeGlobal: aponta o provider pro backend de IA (NIO_AI_BASE_URL) por padrão', () => {
  const d = mkdtempSync(join(tmpdir(), 'nio-ai-'));
  const p = join(d, 'opencode.json');

  installOpencodeGlobal([], p); // sem baseURL explícito → herda o default (NIO_AI_BASE_URL)
  const cfg = JSON.parse(readFileSync(p, 'utf8'));
  expect(cfg.provider[NIO_AI_PROVIDER].options.baseURL).toBe(NIO_AI_BASE_URL);
  expect(cfg.provider[NIO_AI_PROVIDER].models[NIO_AI_MODEL_ID].limit.context).toBe(NIO_AI_CONTEXT);
  expect(cfg.model).toBe(NIO_OPERATOR_MODEL);
  expect(cfg.provider.opencode).toBeUndefined(); // opencode fica no default (big-pickle)

  rmSync(d, { recursive: true, force: true });
});

test('upsertOpencodeMcp: registra um MCP remoto (type: remote + url), preserva o resto', () => {
  const d = mkdtempSync(join(tmpdir(), 'nio-mcp-'));
  const p = join(d, 'opencode.json');
  writeFileSync(p, JSON.stringify({ model: 'x', mcp: { nio: { type: 'local', command: ['nio-cli'] } } }));

  const dockerSpec: McpSpec = { id: 'docker', url: 'http://127.0.0.1:8811/mcp' };
  const r1 = upsertOpencodeMcp(dockerSpec, { path: p });
  expect(r1.status).toBe('updated');
  const cfg = JSON.parse(readFileSync(p, 'utf8'));
  expect(cfg.model).toBe('x');
  expect(cfg.mcp.nio.command).toEqual(['nio-cli']);
  expect(cfg.mcp.docker).toEqual({ type: 'remote', url: 'http://127.0.0.1:8811/mcp', enabled: true });

  // idempotente
  expect(upsertOpencodeMcp(dockerSpec, { path: p }).status).toBe('already_configured');

  // remove → enabled: false
  const r3 = upsertOpencodeMcp(dockerSpec, { remove: true, path: p });
  expect(r3.status).toBe('updated');
  expect(JSON.parse(readFileSync(p, 'utf8')).mcp.docker.enabled).toBe(false);

  rmSync(d, { recursive: true, force: true });
});

test('upsertOpencodeMcp: cria o arquivo se não existe', () => {
  const d = mkdtempSync(join(tmpdir(), 'nio-mcp-'));
  const p = join(d, 'sub', 'opencode.json');
  // path com dir inexistente → writeJson deve criar (mkdir -p no file-merge)
  const r = upsertOpencodeMcp({ id: 'docker', url: 'http://x/mcp' }, { path: p });
  expect(['created', 'updated']).toContain(r.status);
  rmSync(d, { recursive: true, force: true });
});

test('contextConfigWarning: avisa janela pequena demais, silencia janela sã ou desativada', () => {
  expect(contextConfigWarning(10000, 2048)).toBeTruthy(); // 10000 ≤ 2048 + 8000
  expect(contextConfigWarning(98304, 2048)).toBeNull(); // folgada
  expect(contextConfigWarning(0, 2048)).toBeNull(); // 0 = declaração desativada
});

test('compactionReserved: 10% da janela com piso 8000, nunca acima do contexto', () => {
  expect(compactionReserved(98304)).toBe(9830); // ~10% de 98304
  expect(compactionReserved(65536)).toBe(8000); // 10% (6554) < piso → piso
  expect(compactionReserved(200000)).toBe(20000); // 10% de janela grande
  expect(compactionReserved(5000)).toBe(5000); // piso 8000 > contexto → capa no contexto
  expect(compactionReserved(0)).toBe(8000); // declaração desativada → piso
});

test('janela declarada ao opencode = NIO_AI_CONTEXT (a real do provider, não um teto rebaixado)', () => {
  // Declarar menos que a janela real fazia o opencode achar o contexto sempre cheio
  // e auto-compactar em loop. A janela declarada tem que ser a real do provider.
  const { next } = planOpencodeUpdate({}, NIO_ENTRY, [], NIO_AI_BASE_URL);
  const p = next.provider as Record<string, any>;
  expect(p[NIO_AI_PROVIDER].models[NIO_AI_MODEL_ID].limit.context).toBe(NIO_AI_CONTEXT);
});

