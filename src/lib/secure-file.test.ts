import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hardenSecretFile } from './secure-file.js';

function tempSecret(): string {
  const path = join(mkdtempSync(join(tmpdir(), 'nio-secret-')), 'config.env');
  writeFileSync(path, 'JWT_SECRET=x\n', { mode: 0o644 });
  return path;
}

test('arquivo real fica restrito ao dono', () => {
  const path = tempSecret();
  expect(hardenSecretFile(path).outcome).toBe('ok');
  // No Windows quem manda é a ACL, não o modo POSIX — só dá pra afirmar o bit fora dele.
  if (process.platform !== 'win32') expect(statSync(path).mode & 0o077).toBe(0);
});

test('caminho inexistente falha com motivo, não lança', () => {
  const res = hardenSecretFile(join(tmpdir(), 'nao-existe-nio.env'), 'linux');
  expect(res.outcome).toBe('failed');
  expect(res.error).toBeTruthy(); // o chamador precisa do porquê pra avisar
});

test('ACEITE: no Windows não usamos chmod — ele é inócuo no NTFS', () => {
  // Sem USERNAME não há a quem conceder; o contrato é dizer isso, não fingir sucesso.
  const antes = process.env.USERNAME;
  delete process.env.USERNAME;
  try {
    expect(hardenSecretFile(tempSecret(), 'win32').outcome).toBe('unsupported');
  } finally {
    if (antes !== undefined) process.env.USERNAME = antes;
  }
});
