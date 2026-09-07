import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SKILLS_TTL_MS, isFetchedAtStale, skillsMinCliWarning } from './skills-cache.js';

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

// ─── skillsMinCliWarning (§4.1) ─────────────────────────────────────

function bundleDir(minCliVersion?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'nio-skills-'));
  if (minCliVersion !== undefined) {
    writeFileSync(join(dir, 'nio-skills.json'), JSON.stringify({ min_cli_version: minCliVersion }));
  }
  return dir;
}

test('skillsMinCliWarning: bundle pede CLI mais nova → avisa', () => {
  const w = skillsMinCliWarning(bundleDir('0.4.0'), '0.3.7');
  expect(w).toMatch(/>= 0\.4\.0.*0\.3\.7/);
});

test('skillsMinCliWarning: CLI igual ou mais nova → null', () => {
  expect(skillsMinCliWarning(bundleDir('0.3.7'), '0.3.7')).toBeNull();
  expect(skillsMinCliWarning(bundleDir('0.3.0'), '0.3.7')).toBeNull();
  expect(skillsMinCliWarning(bundleDir('0.4.0'), '1.0.0')).toBeNull();
});

test('skillsMinCliWarning: sem nio-skills.json / campo ausente → null (bundle antigo)', () => {
  expect(skillsMinCliWarning(bundleDir(), '0.3.7')).toBeNull(); // arquivo não existe
  const dir = bundleDir();
  writeFileSync(join(dir, 'nio-skills.json'), '{"outra_coisa":1}');
  expect(skillsMinCliWarning(dir, '0.3.7')).toBeNull();
});

test('skillsMinCliWarning: JSON inválido → null (não quebra)', () => {
  const dir = bundleDir();
  writeFileSync(join(dir, 'nio-skills.json'), 'not json');
  expect(skillsMinCliWarning(dir, '0.3.7')).toBeNull();
});
