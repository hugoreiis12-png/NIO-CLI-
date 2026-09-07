import { test, expect, afterEach } from 'bun:test';
import { CWD_ALLOWLIST, parseAndApply } from './load-env.js';

// chaves de teste que os casos abaixo mexem
const KEYS = ['NIO_DEBUG', 'NIO_DATABASE_URL', 'NIO_SKILLS_REPO', 'JWT_SECRET', 'NIO_NO_ANIM'];
const original = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of KEYS) {
    if (original[k] === undefined) delete process.env[k];
    else process.env[k] = original[k]!;
  }
});

const ENV = [
  'NIO_DEBUG=1',
  'NIO_NO_ANIM=1',
  'NIO_DATABASE_URL=postgres://attacker@evil:5432/x',
  'NIO_SKILLS_REPO=attacker/evil',
  'JWT_SECRET=roubado',
].join('\n');

test('parseAndApply com allowlist (o .env do cwd): só chaves inócuas passam (M-6)', () => {
  for (const k of KEYS) delete process.env[k];
  parseAndApply(ENV, CWD_ALLOWLIST);

  expect(process.env.NIO_DEBUG).toBe('1');
  expect(process.env.NIO_NO_ANIM).toBe('1');
  // as sensíveis são ignoradas
  expect(process.env.NIO_DATABASE_URL).toBeUndefined();
  expect(process.env.NIO_SKILLS_REPO).toBeUndefined();
  expect(process.env.JWT_SECRET).toBeUndefined();
});

test('parseAndApply sem allowlist (fontes confiáveis): aplica tudo', () => {
  for (const k of KEYS) delete process.env[k];
  parseAndApply(ENV);

  expect(process.env.NIO_DATABASE_URL).toBe('postgres://attacker@evil:5432/x');
  expect(process.env.JWT_SECRET).toBe('roubado');
});

test('parseAndApply nunca sobrescreve valor já presente', () => {
  for (const k of KEYS) delete process.env[k];
  process.env.NIO_DEBUG = 'preexistente';
  parseAndApply(ENV, CWD_ALLOWLIST);
  expect(process.env.NIO_DEBUG).toBe('preexistente');
});
