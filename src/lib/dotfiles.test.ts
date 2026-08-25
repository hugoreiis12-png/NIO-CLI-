import { test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeManagedDotfiles } from './dotfiles.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nio-dot-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test('escreve envVars/aliases em profile.sh e profile.ps1', () => {
  const res = writeManagedDotfiles({ envVars: { FOO: 'bar' }, aliases: { g: 'git' } }, { dir });
  expect(res.every((r) => r.status === 'written')).toBe(true);

  const sh = readFileSync(join(dir, 'profile.sh'), 'utf-8');
  expect(sh).toContain(`export FOO='bar'`);
  expect(sh).toContain(`alias g='git'`);

  const ps = readFileSync(join(dir, 'profile.ps1'), 'utf-8');
  expect(ps).toContain(`$env:FOO = 'bar'`);
  expect(ps).toContain(`function g { git @args }`);
});

test('sem envVars/aliases → skipped, não cria arquivo', () => {
  const res = writeManagedDotfiles({}, { dir });
  expect(res.every((r) => r.status === 'skipped')).toBe(true);
});

test('idempotente: reescrever não duplica o bloco', () => {
  writeManagedDotfiles({ envVars: { A: '1' } }, { dir });
  writeManagedDotfiles({ envVars: { A: '2' } }, { dir });
  const sh = readFileSync(join(dir, 'profile.sh'), 'utf-8');
  expect((sh.match(/>>> nio managed >>>/g) ?? []).length).toBe(1);
  expect(sh).toContain(`export A='2'`); // valor novo
  expect(sh).not.toContain(`export A='1'`); // valor antigo sumiu
});

test('não-destrutivo: preserva conteúdo do usuário fora do bloco', () => {
  const shPath = join(dir, 'profile.sh');
  writeFileSync(shPath, 'export USER_KEEP=1\n');
  writeManagedDotfiles({ envVars: { A: '1' } }, { dir });
  const sh = readFileSync(shPath, 'utf-8');
  expect(sh).toContain('export USER_KEEP=1'); // linha do usuário intacta
  expect(sh).toContain(`export A='1'`);
});
