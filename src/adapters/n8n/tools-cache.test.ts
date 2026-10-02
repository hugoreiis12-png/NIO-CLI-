import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readToolsCache, writeToolsCache } from './tools-cache.js';

const tmpFile = (name = 'tools.json') => join(mkdtempSync(join(tmpdir(), 'nio-n8n-')), name);

test('ida e volta: grava e lê tools e versão do servidor', () => {
  const path = tmpFile();
  writeToolsCache(['search_workflows', 'execute_workflow'], 'n8n 2.36.0', path);
  const cache = readToolsCache(path);
  expect(cache.tools).toEqual(['search_workflows', 'execute_workflow']);
  expect(cache.serverVersion).toBe('n8n 2.36.0');
  expect(cache.detectedAt).not.toBe('');
});

test('cache ausente devolve lista vazia — o caller trata como sem detecção', () => {
  expect(readToolsCache(tmpFile('nao-existe.json')).tools).toEqual([]);
});

test('JSON corrompido não lança, devolve vazio', () => {
  const path = tmpFile();
  writeFileSync(path, '{ isso nao e json', 'utf8');
  expect(readToolsCache(path).tools).toEqual([]);
});

test('entradas não-string são descartadas em vez de virar tool inválida', () => {
  const path = tmpFile();
  writeFileSync(path, JSON.stringify({ tools: ['ok', 42, null, { a: 1 }] }), 'utf8');
  expect(readToolsCache(path).tools).toEqual(['ok']);
});

test('o cache não guarda segredo nenhum', () => {
  const path = tmpFile();
  writeToolsCache(['search_workflows'], 'n8n 2.36.0', path);
  const body = readFileSync(path, 'utf8');
  expect(body).not.toMatch(/Bearer|token|secret/i);
});
