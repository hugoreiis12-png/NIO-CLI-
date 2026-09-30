/**
 * Liveness por PID. O que importa aqui é não subir um segundo worker do mesmo
 * usuário (desperdício) e não deixar de subir por causa de um PID morto.
 */
import { test, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pidVivo, readWorkerPid } from './worker-process.js';

const dirs: string[] = [];
const novoArquivo = (conteudo: string): string => {
  const d = mkdtempSync(join(tmpdir(), 'nio-worker-'));
  dirs.push(d);
  const f = join(d, 'worker.pid');
  writeFileSync(f, conteudo, 'utf8');
  return f;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

test('lê o PID gravado e ignora lixo', () => {
  expect(readWorkerPid(novoArquivo('4242\n'))).toBe(4242);
  expect(readWorkerPid(novoArquivo('não é número'))).toBeNull();
  // PID 0 e negativo não existem — aceitar viraria `process.kill(0)`, que
  // sinalizaria o GRUPO de processos inteiro.
  expect(readWorkerPid(novoArquivo('0'))).toBeNull();
  expect(readWorkerPid(novoArquivo('-1'))).toBeNull();
  expect(readWorkerPid(join(tmpdir(), 'nio-nao-existe-xyz.pid'))).toBeNull();
});

test('o próprio processo conta como vivo', () => {
  expect(pidVivo(process.pid)).toBe(true);
});

test('PID improvável não conta como vivo', () => {
  // Alto o bastante pra estar fora do range usual; se existir, o teste vira
  // falso-negativo benigno (o worker sobe duplicado uma vez).
  expect(pidVivo(0x7ffffffe)).toBe(false);
});
