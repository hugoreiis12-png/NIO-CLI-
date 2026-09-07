import { test, expect } from 'bun:test';
import { VERSION, OPENCODE_SDK_VERSION, semverGt } from './version.js';

test('VERSION: string x.y.z do package.json', () => {
  expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
});

test('OPENCODE_SDK_VERSION: pin do @opencode-ai/sdk (sem ^/~)', () => {
  expect(OPENCODE_SDK_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
});

test('semverGt: compara major.minor.patch, ignora pré-release', () => {
  expect(semverGt('1.2.4', '1.2.3')).toBe(true);
  expect(semverGt('1.3.0', '1.2.9')).toBe(true);
  expect(semverGt('2.0.0', '1.9.9')).toBe(true);
  expect(semverGt('1.2.3', '1.2.3')).toBe(false);
  expect(semverGt('1.2.3', '1.2.4')).toBe(false);
  expect(semverGt('0.3.7', '0.4.0')).toBe(false);
  expect(semverGt('1.2.3-rc1', '1.2.3')).toBe(false); // pré-release ignorado → iguais
});
