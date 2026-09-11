import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createToolchainGateway } from './toolchain-gateway.js';

// `detect` relativo (resolve a partir do cwd = raiz do projeto) — evita o bug
// pré-existente do globExists com paths absolutos no Windows.
test('ensure: toolchain detectado no disco → present (não instala)', async () => {
  const res = await createToolchainGateway().ensure({ id: 'x', detect: ['package.json'] });
  expect(res.status).toBe('present');
});

test('ensure: não detectado e sem plano de instalação → failed com motivo claro', async () => {
  const res = await createToolchainGateway().ensure({
    id: 'inexistente',
    detect: ['nao/existe/xyz-123'],
  });
  expect(res.status).toBe('failed');
  expect(res.error).toMatch(/sem plano/);
});

test('ensure: instalador roda mas nada materializa → failed de revalidação', async () => {
  // `bun --version` sai 0 sem criar nada — cobre o ramo "instalador rodou mas
  // o toolchain não foi detectado", sem efeito colateral.
  const res = await createToolchainGateway().ensure({
    id: 'fantasma',
    detect: ['nao/existe/xyz-789'],
    install: { program: 'bun', args: ['--version'] },
  });
  expect(res.status).toBe('failed');
  expect(res.error).toMatch(/não foi detectado/);
});

test('ensure: instalador materializa o detect → installed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nio-tc-'));
  try {
    const marker = join(dir, 'tool with space.exe');
    // Aspas simples no script: o quoting do `spawnSyncPortable` no Windows
    // (cmd) não preserva `"` aninhadas; path vai por argv (par único de aspas).
    const res = await createToolchainGateway().ensure({
      id: 'tmp-tool',
      detect: [marker],
      install: {
        program: 'bun',
        args: ['-e', `require('fs').writeFileSync(process.argv[1],'x')`, marker],
      },
    });
    expect(res.status).toBe('installed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
