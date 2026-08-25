import { test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncLangRepos } from './vendor.js';
import { LANG_REPOS } from './repos.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nio-vendor-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test('syncLangRepos: cache presente e sem --force → cached (não toca a rede)', async () => {
  for (const spec of Object.values(LANG_REPOS)) {
    mkdirSync(join(dir, spec.dir), { recursive: true });
  }
  const results = await syncLangRepos({ dir, force: false });
  expect(results).toHaveLength(5);
  expect(results.every((r) => r.status === 'cached')).toBe(true);
  expect(results.map((r) => r.dir).sort()).toEqual(
    Object.values(LANG_REPOS).map((r) => r.dir).sort(),
  );
});
