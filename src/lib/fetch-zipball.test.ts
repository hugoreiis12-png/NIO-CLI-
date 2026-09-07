import { test, expect, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_MAX_ZIP_BYTES,
  codeloadZipUrl,
  fetchZipball,
  isPinnedRef,
  rejectSymlinks,
} from './fetch-zipball.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

// --- H-3: só um commit SHA é pin de integridade ---

test('isPinnedRef: 40 hex → true; branch/tag/curto → false', () => {
  expect(isPinnedRef('ed202ae564e181cae21526b09b23671d947bd53a')).toBe(true);
  expect(isPinnedRef('main')).toBe(false);
  expect(isPinnedRef('v1.2.3')).toBe(false);
  expect(isPinnedRef('ed202ae')).toBe(false);
});

test('codeloadZipUrl: monta a URL do codeload, escapando o ref', () => {
  expect(codeloadZipUrl('o/r', 'abc123')).toBe('https://codeload.github.com/o/r/zip/abc123');
  expect(codeloadZipUrl('o/r', 'feat/x')).toBe('https://codeload.github.com/o/r/zip/feat%2Fx');
});

// --- H-4: teto de tamanho no download ---

function mockFetch(body: Uint8Array, headers: Record<string, string> = {}) {
  globalThis.fetch = (async () =>
    new Response(body, { status: 200, headers })) as typeof fetch;
}

test('fetchZipball: baixa o buffer quando dentro do teto', async () => {
  const payload = new TextEncoder().encode('zip-bytes');
  mockFetch(payload);
  const buf = await fetchZipball('https://x/y', { timeoutMs: 1000 });
  expect(buf.toString('utf8')).toBe('zip-bytes');
});

test('fetchZipball: Content-Length acima do teto → rejeita sem baixar', async () => {
  mockFetch(new Uint8Array(1), { 'content-length': String(DEFAULT_MAX_ZIP_BYTES + 1) });
  await expect(fetchZipball('https://x/y', { timeoutMs: 1000 })).rejects.toThrow(/grande demais/);
});

test('fetchZipball: stream que estoura o teto → aborta', async () => {
  const big = new Uint8Array(200);
  mockFetch(big);
  await expect(
    fetchZipball('https://x/y', { timeoutMs: 1000, maxBytes: 100 }),
  ).rejects.toThrow(/teto/);
});

test('fetchZipball: HTTP != 2xx → lança', async () => {
  globalThis.fetch = (async () => new Response('nope', { status: 404 })) as typeof fetch;
  await expect(fetchZipball('https://x/y', { timeoutMs: 1000 })).rejects.toThrow(/HTTP 404/);
});

// --- TP-4: symlink no bundle extraído ---

test('rejectSymlinks: árvore limpa passa; symlink (mesmo aninhado) lança', () => {
  const root = mkdtempSync(join(tmpdir(), 'nio-sym-'));
  try {
    mkdirSync(join(root, 'sub'), { recursive: true });
    writeFileSync(join(root, 'sub', 'ok.md'), '# ok');
    expect(() => rejectSymlinks(root)).not.toThrow();

    symlinkSync('/etc/passwd', join(root, 'sub', 'evil'));
    expect(() => rejectSymlinks(root)).toThrow(/symlink recusada/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
