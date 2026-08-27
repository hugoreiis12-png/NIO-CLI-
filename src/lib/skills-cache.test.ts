import { test, expect } from 'bun:test';
import { SKILLS_TTL_MS, isFetchedAtStale } from './skills-cache.js';

const NOW = 1_000_000_000_000;

test('isFetchedAtStale: dentro do TTL → não é velho', () => {
  const fresh = new Date(NOW - SKILLS_TTL_MS + 60_000).toISOString();
  expect(isFetchedAtStale(fresh, SKILLS_TTL_MS, NOW)).toBe(false);
});

test('isFetchedAtStale: além do TTL → velho', () => {
  const old = new Date(NOW - SKILLS_TTL_MS - 60_000).toISOString();
  expect(isFetchedAtStale(old, SKILLS_TTL_MS, NOW)).toBe(true);
});

test('isFetchedAtStale: ausente → velho (força fetch)', () => {
  expect(isFetchedAtStale(null, SKILLS_TTL_MS, NOW)).toBe(true);
  expect(isFetchedAtStale(undefined, SKILLS_TTL_MS, NOW)).toBe(true);
  expect(isFetchedAtStale('', SKILLS_TTL_MS, NOW)).toBe(true);
});

test('isFetchedAtStale: fetchedAt corrompido → velho', () => {
  expect(isFetchedAtStale('não-é-data', SKILLS_TTL_MS, NOW)).toBe(true);
});

test('isFetchedAtStale: ttl/now injetáveis', () => {
  const at = new Date(1_000_000).toISOString();
  expect(isFetchedAtStale(at, 500, 1_000_400)).toBe(false);
  expect(isFetchedAtStale(at, 500, 1_000_600)).toBe(true);
});

test('SKILLS_TTL_MS: 7 dias', () => {
  expect(SKILLS_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
});
