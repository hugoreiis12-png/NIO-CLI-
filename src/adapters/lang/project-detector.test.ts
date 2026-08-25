import { test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProjectDetector } from './project-detector.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nio-detect-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const det = () => createProjectDetector();

test('dir vazio → empty:true, tudo false', () => {
  const ctx = det().detect(dir);
  expect(ctx.empty).toBe(true);
  expect(ctx.hasPackageJson).toBe(false);
  expect(ctx.hasPyproject).toBe(false);
  expect(ctx.hasCsproj).toBe(false);
  expect(ctx.nodePackageManager).toBeUndefined();
});

test('só o marker .nio-lang.json → ainda conta como vazio', () => {
  writeFileSync(join(dir, '.nio-lang.json'), '{}');
  expect(det().detect(dir).empty).toBe(true);
});

test('projeto node com package-lock → hasPackageJson + pm npm, não-vazio', () => {
  writeFileSync(join(dir, 'package.json'), '{}');
  writeFileSync(join(dir, 'package-lock.json'), '{}');
  const ctx = det().detect(dir);
  expect(ctx.empty).toBe(false);
  expect(ctx.hasPackageJson).toBe(true);
  expect(ctx.nodePackageManager).toBe('npm');
});

test('pnpm-lock tem precedência sobre outros', () => {
  writeFileSync(join(dir, 'package.json'), '{}');
  writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
  writeFileSync(join(dir, 'package-lock.json'), '{}');
  expect(det().detect(dir).nodePackageManager).toBe('pnpm');
});

test('python (pyproject) e csharp (.csproj) são sinalizados', () => {
  writeFileSync(join(dir, 'pyproject.toml'), '');
  mkdirSync(join(dir, 'sub'), { recursive: true });
  writeFileSync(join(dir, 'App.csproj'), '');
  const ctx = det().detect(dir);
  expect(ctx.hasPyproject).toBe(true);
  expect(ctx.hasCsproj).toBe(true);
});
