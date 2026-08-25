import { test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCoAuthoredBy, disableCoAuthoredBy, planOpencodeUpdate, NIO_OPERATOR_MODEL } from './client-configs.js';
import type { McpSpec } from '../core/environment.js';

const NIO_ENTRY = { command: ['nio-cli'], environment: {} as Record<string, string> };
const PG_MCP: McpSpec = {
  id: 'postgres',
  command: ['npx', '-y', '@modelcontextprotocol/server-postgres'],
  environment: { DATABASE_URL: 'x' },
};

test('planOpencodeUpdate: grava model + mcp.nio + MCPs do perfil num config vazio', () => {
  const { next } = planOpencodeUpdate({}, NIO_ENTRY, [PG_MCP]);
  expect(next.model).toBe(NIO_OPERATOR_MODEL);
  const mcp = next.mcp as Record<string, { command: string[]; enabled?: boolean }>;
  expect(mcp.nio.command).toEqual(['nio-cli']);
  expect(mcp.postgres.command).toEqual(PG_MCP.command);
  expect(mcp.postgres.enabled).toBe(true);
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
  const mcp = next.mcp as Record<string, { command: string[] }>;
  expect(mcp.custom.command).toEqual(['meu-mcp']); // chave do usuário intacta
  expect(mcp.nio.command).toEqual(['nio-cli']);
  expect(mcp.postgres.command).toEqual(PG_MCP.command);
});

// os.homedir() ignora $HOME no macOS, então passamos o path do settings.json
// explicitamente (o seam opcional) em vez de tentar sequestrar o home.
let dir: string;
let settings: string;

function writeSettings(obj: unknown) {
  writeFileSync(settings, JSON.stringify(obj));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nio-co-'));
  settings = join(dir, 'settings.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test('sem settings.json → assume ligado (default do Claude Code)', () => {
  expect(readCoAuthoredBy(settings).enabled).toBe(true);
});

test('includeCoAuthoredBy ausente → ligado', () => {
  writeSettings({ mcpServers: {} });
  expect(readCoAuthoredBy(settings).enabled).toBe(true);
});

test('includeCoAuthoredBy=true → ligado', () => {
  writeSettings({ includeCoAuthoredBy: true });
  expect(readCoAuthoredBy(settings).enabled).toBe(true);
});

test('includeCoAuthoredBy=false → desligado (não nagueia)', () => {
  writeSettings({ includeCoAuthoredBy: false });
  expect(readCoAuthoredBy(settings).enabled).toBe(false);
});

test('disable preserva chaves existentes, faz backup e seta false', () => {
  writeSettings({ mcpServers: { nio: { command: 'nio-cli' } } });
  const res = disableCoAuthoredBy(settings);
  expect(res.status).toBe('updated');
  expect(res.backup && existsSync(res.backup)).toBeTruthy();

  const written = JSON.parse(readFileSync(res.path, 'utf8'));
  expect(written.includeCoAuthoredBy).toBe(false);
  expect(written.mcpServers.nio.command).toBe('nio-cli'); // não perdeu nada
  expect(readCoAuthoredBy(settings).enabled).toBe(false);
});
