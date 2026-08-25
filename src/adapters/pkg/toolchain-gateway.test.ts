import { test, expect } from 'bun:test';
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
