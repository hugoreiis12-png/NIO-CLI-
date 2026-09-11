import { test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  installVSCodeRepo,
  planOpencodeUpdate,
  NIO_OPERATOR_MODEL,
  DEFAULT_OPENCODE_COMPACTION,
  DEFAULT_OPENCODE_WATCHER,
  DEFAULT_OPENCODE_PERMISSION,
} from './client-configs.js';
import { envName } from '../../brand.js';

// Cobertura que faltava: `client-configs.test.ts` só cobre o planOpencodeUpdate puro.
// installVSCodeRepo recebe `cwd` explícito — testável sem tocar $HOME.

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nio-install-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

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

// --- planOpencodeUpdate(existing, nioEntry) — pura, extraída de installOpencodeGlobal ---

const CLIENT_ENV = envName('CLIENT'); // 'NIO_CLIENT'
const opencodeEntry = { command: ['nio-cli'], environment: { [CLIENT_ENV]: 'opencode' } };

test('planOpencodeUpdate: sem mcp existente → não configurado, monta a entrada + o model default', () => {
  const { alreadyConfigured, next } = planOpencodeUpdate({}, opencodeEntry);
  expect(alreadyConfigured).toBe(false);
  expect((next.mcp as any).nio).toEqual({ type: 'local', ...opencodeEntry, enabled: true });
  expect(next.model).toBe(NIO_OPERATOR_MODEL);
});

test('planOpencodeUpdate: entrada já idêntica (command + environment + enabled + model + permission + compaction + watcher) → já configurado', () => {
  const existing = {
    model: NIO_OPERATOR_MODEL,
    mcp: { nio: { type: 'local', ...opencodeEntry, enabled: true } },
    permission: DEFAULT_OPENCODE_PERMISSION,
    compaction: DEFAULT_OPENCODE_COMPACTION,
    watcher: DEFAULT_OPENCODE_WATCHER,
  };
  const { alreadyConfigured } = planOpencodeUpdate(existing, opencodeEntry);
  expect(alreadyConfigured).toBe(true);
});

test('planOpencodeUpdate (Sprint 7.5): semeia `permission` quando ausente, preserva o do usuário', () => {
  // ausente → semeia os defaults + força a re-escrita
  const seeded = planOpencodeUpdate(
    { model: NIO_OPERATOR_MODEL, mcp: { nio: { type: 'local', ...opencodeEntry, enabled: true } } },
    opencodeEntry,
  );
  expect(seeded.alreadyConfigured).toBe(false);
  expect((seeded.next.permission as any).bash['ls *']).toBe('allow');
  expect((seeded.next.permission as any).bash['*']).toBe('ask');
  expect((seeded.next.permission as any).edit).toBe('ask');

  // já presente → NÃO sobrescreve (e com compaction/watcher em dia, fica configurado)
  const mine = { bash: { 'rm *': 'deny', '*': 'allow' } };
  const kept = planOpencodeUpdate(
    {
      model: NIO_OPERATOR_MODEL,
      mcp: { nio: { type: 'local', ...opencodeEntry, enabled: true } },
      permission: mine,
      compaction: DEFAULT_OPENCODE_COMPACTION,
      watcher: DEFAULT_OPENCODE_WATCHER,
    },
    opencodeEntry,
  );
  expect(kept.next.permission).toEqual(mine);
  expect(kept.alreadyConfigured).toBe(true);
});

test('planOpencodeUpdate: model ausente → não configurado, next seta o default', () => {
  const existing = { mcp: { nio: { type: 'local', ...opencodeEntry, enabled: true } } };
  const { alreadyConfigured, next } = planOpencodeUpdate(existing, opencodeEntry);
  expect(alreadyConfigured).toBe(false);
  expect(next.model).toBe(NIO_OPERATOR_MODEL);
});

test('planOpencodeUpdate: model diferente do default → não configurado, next sobrescreve', () => {
  const existing = { model: 'outro-modelo', mcp: { nio: { type: 'local', ...opencodeEntry, enabled: true } } };
  const { alreadyConfigured, next } = planOpencodeUpdate(existing, opencodeEntry);
  expect(alreadyConfigured).toBe(false);
  expect(next.model).toBe(NIO_OPERATOR_MODEL);
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
