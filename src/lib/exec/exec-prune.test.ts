/**
 * Retenção do store local de jobs. O `exec-delegate` ficou fora do task system
 * de propósito (ADR 0015) — o defeito que restava era o diretório crescer para
 * sempre, um `.json` por `/implement`, nunca apagado.
 */
import { test, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pruneOldJobs, EXEC_JOB_RETENTION_DAYS } from './exec-delegate.js';

const dirs: string[] = [];
const novoDir = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'nio-exec-jobs-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const DIA_MS = 24 * 60 * 60 * 1000;

/** Cria um `.json` com mtime de `diasAtras`. */
function jobComIdade(dir: string, nome: string, diasAtras: number): string {
  const alvo = join(dir, nome);
  writeFileSync(alvo, '{}', 'utf8');
  const quando = new Date(Date.now() - diasAtras * DIA_MS);
  utimesSync(alvo, quando, quando);
  return alvo;
}

test('apaga o que passou da retenção e preserva o recente', () => {
  const d = novoDir();
  jobComIdade(d, 'velho.json', EXEC_JOB_RETENTION_DAYS + 3);
  jobComIdade(d, 'novo.json', 1);

  expect(pruneOldJobs(d)).toBe(1);
  expect(readdirSync(d)).toEqual(['novo.json']);
});

test('não toca em arquivo que não é job', () => {
  const d = novoDir();
  jobComIdade(d, 'velho.json', 99);
  jobComIdade(d, 'README.md', 99);

  pruneOldJobs(d);
  // Filtrar por extensão evita apagar algo que outra coisa pôs no diretório.
  expect(readdirSync(d)).toEqual(['README.md']);
});

test('diretório inexistente não lança — limpar não pode quebrar execução', () => {
  expect(pruneOldJobs(join(tmpdir(), 'nio-nao-existe-xyz'))).toBe(0);
});

test('corte é exatamente a retenção, não um dia a mais', () => {
  const d = novoDir();
  jobComIdade(d, 'no-limite.json', EXEC_JOB_RETENTION_DAYS - 0.5);
  jobComIdade(d, 'passou.json', EXEC_JOB_RETENTION_DAYS + 0.5);

  expect(pruneOldJobs(d)).toBe(1);
  expect(readdirSync(d)).toEqual(['no-limite.json']);
});
