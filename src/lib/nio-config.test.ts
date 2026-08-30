import { test, expect } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnvFile, readConfigFile, writeConfigFile, validateConfigShape } from './nio-config.js';

test('parseEnvFile: KEY=value, ignora # e vazio, mantém = no valor', () => {
  const out = parseEnvFile('# comentário\n\nNIO_DATABASE_URL=postgres://u:p@h:5432/d\nJWT_SECRET=a=b=c\n  \n');
  expect(out.NIO_DATABASE_URL).toBe('postgres://u:p@h:5432/d');
  expect(out.JWT_SECRET).toBe('a=b=c');
  expect(Object.keys(out).length).toBe(2);
});

test('writeConfigFile: cria, chmod 600, funde preservando chaves existentes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nio-cfg-'));
  const path = join(dir, 'config.env');
  writeConfigFile({ NIO_DATABASE_URL: 'postgres://a@b:5432/c', JWT_SECRET: 'seg' }, path);
  expect(readConfigFile(path)).toEqual({
    NIO_DATABASE_URL: 'postgres://a@b:5432/c',
    JWT_SECRET: 'seg',
  });
  writeConfigFile({ JWT_SECRET: 'novo', NIO_DATABASE_SSL: 'true' }, path);
  expect(readConfigFile(path)).toEqual({
    NIO_DATABASE_URL: 'postgres://a@b:5432/c',
    JWT_SECRET: 'novo',
    NIO_DATABASE_SSL: 'true',
  });
  expect(readFileSync(path, 'utf8').startsWith('# Config da NIO-CLI')).toBe(true);
});

test('readConfigFile: arquivo ausente → {}', () => {
  expect(readConfigFile(join(tmpdir(), 'nao-existe-' + Date.now(), 'x.env'))).toEqual({});
});

test('validateConfigShape: pega faltando e formato inválido, sem tocar rede', () => {
  expect(validateConfigShape({})).toEqual([
    { key: 'NIO_DATABASE_URL', issue: 'missing', hint: expect.any(String) },
    { key: 'JWT_SECRET', issue: 'missing', hint: expect.any(String) },
  ]);
  const bad = validateConfigShape({ NIO_DATABASE_URL: 'mysql://x', JWT_SECRET: 's' });
  expect(bad).toEqual([{ key: 'NIO_DATABASE_URL', issue: 'invalid', hint: expect.any(String) }]);
  expect(validateConfigShape({ NIO_DATABASE_URL: 'postgres://u@h:5432/d', JWT_SECRET: 's' })).toEqual([]);
});
