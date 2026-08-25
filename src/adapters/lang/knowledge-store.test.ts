import { test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKnowledgeStore } from './knowledge-store.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nio-lang-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test('reference: repo vendorado presente → devolve o README (found)', () => {
  mkdirSync(join(dir, 'typescript-sdk'), { recursive: true });
  writeFileSync(join(dir, 'typescript-sdk', 'README.md'), '# TS SDK\nconteúdo de referência');

  const ref = createKnowledgeStore(dir).reference('typescript');
  expect(ref.found).toBe(true);
  expect(ref.content).toContain('conteúdo de referência');
  expect(ref.source).toBe('typescript-sdk');
});

test('reference: cache ausente → found:false com mensagem de sync', () => {
  const ref = createKnowledgeStore(dir).reference('python');
  expect(ref.found).toBe(false);
  expect(ref.content).toMatch(/nio lang sync/);
});

test('reference com topic: devolve o .md mais relevante (não o README)', () => {
  const repo = join(dir, 'python-sdk');
  mkdirSync(join(repo, 'docs'), { recursive: true });
  writeFileSync(join(repo, 'README.md'), '# Python SDK\nintro geral');
  writeFileSync(join(repo, 'docs', 'authentication.md'), '# Auth\ncomo fazer authentication no server');

  const ref = createKnowledgeStore(dir).reference('python', 'authentication');
  expect(ref.found).toBe(true);
  expect(ref.source).toBe('python-sdk/docs/authentication.md');
  expect(ref.content).toContain('como fazer authentication');
});

test('reference com topic sem match → cai no README com aviso', () => {
  const repo = join(dir, 'csharp-sdk');
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, 'README.md'), '# C# SDK\nintro');

  const ref = createKnowledgeStore(dir).reference('csharp', 'topicoinexistentexyz');
  expect(ref.found).toBe(true);
  expect(ref.source).toBe('csharp-sdk');
  expect(ref.content).toMatch(/nenhum doc casou/);
});
