import { test, expect } from 'bun:test';
import { statusLabel } from './fabric.js';

// Regressão: um AADSTS50126 (usuário/senha) vinha rotulado como "service principal
// sem permissão", mandando procurar no portal do Azure em vez de na credencial.
test('com diagnóstico do Entra, não chuta causa', () => {
  const label = statusLabel('unauthorized', 'token endpoint respondeu 400 (AADSTS50126): usuário ou senha inválidos');
  expect(label).toBe('recusou a credencial');
  expect(label).not.toContain('service principal');
  expect(label).not.toContain('RLS');
});

test('sem diagnóstico do Entra, lista as causas prováveis', () => {
  const label = statusLabel('unauthorized', 'falha opaca do proxy');
  expect(label).toContain('service principal sem permissão');
});

test('unauthorized sem erro nenhum ainda lista as causas', () => {
  expect(statusLabel('unauthorized')).toContain('tenant setting');
});

test('demais status não são afetados pelo diagnóstico', () => {
  expect(statusLabel('unavailable', 'AADSTS50126')).toBe('indisponível (rede/timeout)');
  expect(statusLabel('throttled')).toContain('429');
  expect(statusLabel('failed')).toBe('falhou');
});