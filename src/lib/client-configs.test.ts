import { test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCoAuthoredBy, disableCoAuthoredBy } from './client-configs.js';

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
