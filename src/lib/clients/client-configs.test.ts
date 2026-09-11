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
  NIO_AI_EFFECTIVE_CONTEXT,
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
  // Contexto EFETIVO (rebaixado p/ caber NIO_AI_MAX_INPUT), não o cru do modelo.
  expect(p[NIO_AI_PROVIDER].models[NIO_AI_MODEL_ID].limit.context).toBe(NIO_AI_EFFECTIVE_CONTEXT);
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
  expect(cfg.provider[NIO_AI_PROVIDER].models[NIO_AI_MODEL_ID].limit.context).toBe(NIO_AI_EFFECTIVE_CONTEXT);
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

test('NIO_AI_EFFECTIVE_CONTEXT: cabe input + output, sem passar do contexto real', () => {
  // Com os defaults (max_input 32000, output 2048), a janela declarada rebaixa
  // pra 34048 — o opencode passa a orçar o input em ~32000, não nos 65536 crus.
  expect(NIO_AI_EFFECTIVE_CONTEXT).toBeLessThanOrEqual(65536);
  expect(NIO_AI_EFFECTIVE_CONTEXT).toBeGreaterThan(0);
});
