import { test, expect } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnvFile, readConfigFile, writeConfigFile, validateConfigShape, probeAiBackend, describePingFailure } from './nio-config.js';

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

test('writeConfigFile: grava SSL=false explícito e remove flag vazio (troca de modo TLS)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nio-cfg-ssl-'));
  const path = join(dir, 'config.env');
  // modo "insecure" antes: SSL on + flag insecure
  writeConfigFile({ NIO_DATABASE_SSL: 'true', NIO_DATABASE_SSL_INSECURE: '1' }, path);
  expect(readConfigFile(path).NIO_DATABASE_SSL_INSECURE).toBe('1');
  // troca pra "off": SSL=false explícito e insecure='' deve SUMIR do arquivo
  writeConfigFile({ NIO_DATABASE_SSL: 'false', NIO_DATABASE_SSL_INSECURE: '' }, path);
  const out = readConfigFile(path);
  expect(out.NIO_DATABASE_SSL).toBe('false');
  expect('NIO_DATABASE_SSL_INSECURE' in out).toBe(false);
});

test('validateConfigShape: pega faltando e formato inválido, sem tocar rede', () => {
  expect(validateConfigShape({})).toEqual([
    { key: 'NIO_DATABASE_URL', issue: 'missing', hint: expect.any(String) },
    { key: 'JWT_SECRET', issue: 'missing', hint: expect.any(String) },
  ]);
  const strong = 'x7K2p9Qw3mZ1aB5nR8tL4vE6cH0jY2sD';
  const bad = validateConfigShape({ NIO_DATABASE_URL: 'mysql://x', JWT_SECRET: strong });
  expect(bad).toEqual([{ key: 'NIO_DATABASE_URL', issue: 'invalid', hint: expect.any(String) }]);
  expect(validateConfigShape({ NIO_DATABASE_URL: 'postgres://u@h:5432/d', JWT_SECRET: strong })).toEqual([]);

  // JWT_SECRET fraco (H-1): curto ou sem variedade → 'invalid'
  const weak = validateConfigShape({ NIO_DATABASE_URL: 'postgres://u@h:5432/d', JWT_SECRET: 's' });
  expect(weak).toEqual([{ key: 'JWT_SECRET', issue: 'invalid', hint: expect.any(String) }]);
  expect(
    validateConfigShape({ NIO_DATABASE_URL: 'postgres://u@h:5432/d', JWT_SECRET: 'a'.repeat(40) }),
  ).toEqual([{ key: 'JWT_SECRET', issue: 'invalid', hint: expect.any(String) }]);
});

test('probeAiBackend: porta fechada → ok:false sem estourar', async () => {
  const st = await probeAiBackend(2000, 'http://127.0.0.1:9/v1');
  expect(st.ok).toBe(false);
  expect(st.models).toEqual([]);
  expect(st.detail.length).toBeGreaterThan(0);
});

test('describePingFailure: cada kind TLS é fixable com hint próprio; unknown genérico não abre wizard', () => {
  for (const kind of ['tls-self-signed', 'tls-expired', 'tls-server-off', 'tls-required'] as const) {
    const h = describePingFailure({ ok: false, tlsKind: kind });
    expect(h.fixable).toBe(true);
    expect(h.hint.length).toBeGreaterThan(0);
  }
  // hints distintos por causa (não um genérico só)
  const hints = new Set(
    (['tls-self-signed', 'tls-expired', 'tls-server-off', 'tls-required'] as const).map(
      (k) => describePingFailure({ ok: false, tlsKind: k }).hint,
    ),
  );
  expect(hints.size).toBe(4);
  // fallback legado preservado
  expect(describePingFailure({ ok: false, tlsKind: 'unknown' })).toEqual({
    fixable: false,
    hint: expect.any(String),
  });
  expect(describePingFailure({ ok: false, tlsKind: 'unknown', tlsCertError: true }).fixable).toBe(true);
});
