/**
 * Gate de arquitetura: nenhuma superfície fora de `src/app/` fala com o
 * `SessionRepository` direto.
 *
 * Existe porque o comentário sozinho não segurou: o `SessionManager` se declara
 * "o ponto ÚNICO" desde 2026-06 e ficou furado em 7 arquivos —
 * `cli/commands/{ai,debug,deps,docker,open}.ts`, `cli/flows/onboarding.ts`,
 * `tui/launch.tsx` (BACKLOG-TECNICO § 2.1, fechado em 2026-09-30 com este teste
 * como trava). Espelha `task-boundary.test.ts` — duplicado de propósito: são
 * dois invariantes independentes, e um não pode sumir se o outro for apagado.
 */
import { test, expect } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

const RESTRITO = 'adapters/pg/session-repository';

function arquivosFonte(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...arquivosFonte(full));
      continue;
    }
    if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Quem pode importar: o app layer (dono da regra) e testes — não é superfície de produção. */
function permitido(rel: string): boolean {
  const norm = rel.split(sep).join('/');
  if (/\.test\.tsx?$/.test(norm)) return true;
  return norm.startsWith('app/');
}

function importaRestrito(conteudo: string): boolean {
  return conteudo.includes(RESTRITO);
}

// 30s: lê o src/ inteiro, NTFS é lento sob a suíte cheia (§ 11.1).
test('nenhuma superfície fora de src/app importa o SessionRepository', () => {
  const infratores: string[] = [];
  for (const file of arquivosFonte(SRC)) {
    const rel = relative(SRC, file);
    if (permitido(rel)) continue;
    if (importaRestrito(readFileSync(file, 'utf8'))) {
      infratores.push(rel.split(sep).join('/'));
    }
  }
  expect(
    infratores,
    `passe pelo SessionManager em vez de importar direto:\n  ${infratores.join('\n  ')}`,
  ).toEqual([]);
}, 30_000);

test('o gate enxerga uma violação plantada — senão não prova nada', () => {
  expect(importaRestrito("import { x } from '../adapters/pg/session-repository.js';")).toBe(true);
  expect(importaRestrito("import { y } from '../adapters/pg/task-repository.js';")).toBe(false);
  expect(permitido(join('cli', 'commands', 'open.ts'))).toBe(false);
  expect(permitido(join('app', 'session-manager.ts'))).toBe(true);
});
