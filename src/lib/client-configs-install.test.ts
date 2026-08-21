import { test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  installClaudeCodeRepo,
  installVSCodeRepo,
  planCodexUpdate,
  planOpencodeUpdate,
} from './client-configs.js';
import { envName } from '../brand.js';

// Cobertura que faltava: `client-configs.test.ts` só cobre readCoAuthoredBy/disableCoAuthoredBy.
// installClaudeCodeRepo/installVSCodeRepo recebem `cwd` explícito — testáveis sem tocar $HOME.

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nio-install-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// --- installClaudeCodeRepo(cwd) -> <cwd>/.mcp.json, rootKey 'mcpServers' ---

test('installClaudeCodeRepo: arquivo ausente → created, com chave/command do white-label', () => {
  const res = installClaudeCodeRepo(dir);
  expect(res.status).toBe('created');
  expect(res.path).toBe(join(dir, '.mcp.json'));

  const written = JSON.parse(readFileSync(res.path, 'utf8'));
  // Pina o default white-label: chave literal `nio`, comando literal `nio-cli`.
  expect(written.mcpServers.nio.command).toBe('nio-cli');
});

test('installClaudeCodeRepo: arquivo presente com o mesmo command → already_configured', () => {
  const path = join(dir, '.mcp.json');
  writeFileSync(path, JSON.stringify({ mcpServers: { nio: { command: 'nio-cli' } } }));

  const res = installClaudeCodeRepo(dir);
  expect(res.status).toBe('already_configured');
  expect(res.backup).toBeUndefined();
});

test('installClaudeCodeRepo: arquivo presente com outro conteúdo → updated, backup, preserva chaves', () => {
  const path = join(dir, '.mcp.json');
  writeFileSync(
    path,
    JSON.stringify({ mcpServers: { outroServidor: { command: 'algo' } } }),
  );

  const res = installClaudeCodeRepo(dir);
  expect(res.status).toBe('updated');
  expect(res.backup && existsSync(res.backup)).toBeTruthy();

  const written = JSON.parse(readFileSync(res.path, 'utf8'));
  expect(written.mcpServers.nio.command).toBe('nio-cli');
  expect(written.mcpServers.outroServidor.command).toBe('algo'); // não perdeu nada
});

// --- installVSCodeRepo(cwd) -> <cwd>/.vscode/mcp.json, rootKey 'servers' ---

test('installVSCodeRepo: arquivo ausente → created, com chave/command do white-label', () => {
  const res = installVSCodeRepo(dir);
  expect(res.status).toBe('created');
  expect(res.path).toBe(join(dir, '.vscode', 'mcp.json'));

  const written = JSON.parse(readFileSync(res.path, 'utf8'));
  expect(written.servers.nio.command).toBe('nio-cli');
});

test('installVSCodeRepo: arquivo presente com o mesmo command → already_configured', () => {
  mkdirSync(join(dir, '.vscode'), { recursive: true });
  const path = join(dir, '.vscode', 'mcp.json');
  writeFileSync(path, JSON.stringify({ servers: { nio: { command: 'nio-cli' } } }));

  const res = installVSCodeRepo(dir);
  expect(res.status).toBe('already_configured');
});

test('installVSCodeRepo: arquivo presente com outro conteúdo → updated, backup, preserva chaves', () => {
  mkdirSync(join(dir, '.vscode'), { recursive: true });
  const path = join(dir, '.vscode', 'mcp.json');
  writeFileSync(path, JSON.stringify({ servers: { outroServidor: { command: 'algo' } } }));

  const res = installVSCodeRepo(dir);
  expect(res.status).toBe('updated');
  expect(res.backup && existsSync(res.backup)).toBeTruthy();

  const written = JSON.parse(readFileSync(res.path, 'utf8'));
  expect(written.servers.nio.command).toBe('nio-cli');
  expect(written.servers.outroServidor.command).toBe('algo');
});

// --- planCodexUpdate(existing, nioEntry) — pura, extraída de installCodexGlobal ---

const CLIENT_ENV = envName('CLIENT'); // 'NIO_CLIENT'
const nioEntry = { command: 'nio-cli', env: { [CLIENT_ENV]: 'codex' } };

test('planCodexUpdate: sem mcp_servers existente → não configurado, monta a entrada', () => {
  const { alreadyConfigured, next } = planCodexUpdate({}, nioEntry);
  expect(alreadyConfigured).toBe(false);
  expect((next.mcp_servers as any).nio).toEqual(nioEntry);
});

test('planCodexUpdate: entrada já idêntica (command + env) → já configurado', () => {
  const existing = { mcp_servers: { nio: { ...nioEntry } } };
  const { alreadyConfigured } = planCodexUpdate(existing, nioEntry);
  expect(alreadyConfigured).toBe(true);
});

test('planCodexUpdate: command diferente → não configurado, next atualiza a entrada', () => {
  const existing = { mcp_servers: { nio: { command: 'outro-bin', env: { [CLIENT_ENV]: 'codex' } } } };
  const { alreadyConfigured, next } = planCodexUpdate(existing, nioEntry);
  expect(alreadyConfigured).toBe(false);
  expect((next.mcp_servers as any).nio.command).toBe('nio-cli');
});

test('planCodexUpdate: env NIO_CLIENT ausente (instalação antiga) → não configurado', () => {
  const existing = { mcp_servers: { nio: { command: 'nio-cli' } } };
  const { alreadyConfigured, next } = planCodexUpdate(existing, nioEntry);
  expect(alreadyConfigured).toBe(false);
  expect((next.mcp_servers as any).nio.env[CLIENT_ENV]).toBe('codex');
});

test('planCodexUpdate: preserva outras chaves top-level e outros mcp_servers', () => {
  const existing = {
    outraChave: 'valor',
    mcp_servers: { outroServidor: { command: 'algo' } },
  };
  const { next } = planCodexUpdate(existing, nioEntry);
  expect(next.outraChave).toBe('valor');
  expect((next.mcp_servers as any).outroServidor.command).toBe('algo');
  expect((next.mcp_servers as any).nio.command).toBe('nio-cli');
});

// --- planOpencodeUpdate(existing, nioEntry) — pura, extraída de installOpencodeGlobal ---

const opencodeEntry = { command: ['nio-cli'], environment: { [CLIENT_ENV]: 'opencode' } };

test('planOpencodeUpdate: sem mcp existente → não configurado, monta a entrada', () => {
  const { alreadyConfigured, next } = planOpencodeUpdate({}, opencodeEntry);
  expect(alreadyConfigured).toBe(false);
  expect((next.mcp as any).nio).toEqual({ type: 'local', ...opencodeEntry, enabled: true });
});

test('planOpencodeUpdate: entrada já idêntica (command + environment + enabled) → já configurado', () => {
  const existing = { mcp: { nio: { type: 'local', ...opencodeEntry, enabled: true } } };
  const { alreadyConfigured } = planOpencodeUpdate(existing, opencodeEntry);
  expect(alreadyConfigured).toBe(true);
});

test('planOpencodeUpdate: command diferente → não configurado, next atualiza a entrada', () => {
  const existing = {
    mcp: { nio: { type: 'local', command: ['outro-bin'], environment: { [CLIENT_ENV]: 'opencode' }, enabled: true } },
  };
  const { alreadyConfigured, next } = planOpencodeUpdate(existing, opencodeEntry);
  expect(alreadyConfigured).toBe(false);
  expect((next.mcp as any).nio.command).toEqual(['nio-cli']);
});

test('planOpencodeUpdate: enabled=false (usuário desligou) → não configurado', () => {
  const existing = { mcp: { nio: { type: 'local', ...opencodeEntry, enabled: false } } };
  const { alreadyConfigured, next } = planOpencodeUpdate(existing, opencodeEntry);
  expect(alreadyConfigured).toBe(false);
  expect((next.mcp as any).nio.enabled).toBe(true);
});

test('planOpencodeUpdate: preserva outras chaves top-level e outros servidores mcp', () => {
  const existing = {
    outraChave: 'valor',
    mcp: { outroServidor: { type: 'local', command: ['algo'] } },
  };
  const { next } = planOpencodeUpdate(existing, opencodeEntry);
  expect(next.outraChave).toBe('valor');
  expect((next.mcp as any).outroServidor.command).toEqual(['algo']);
  expect((next.mcp as any).nio.command).toEqual(['nio-cli']);
});
