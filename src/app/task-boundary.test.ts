/**
 * Gate de arquitetura: nenhuma superfície fora de `src/app/` fala com os
 * repositórios de task direto.
 *
 * Existe porque a alternativa já falhou no projeto: o `SessionManager` declara
 * ser "o ponto ÚNICO" num comentário desde 2026-06 e está furado em 7 arquivos
 * (`cli/commands/{ai,debug,deps,docker,open}.ts`, `cli/flows/onboarding.ts`,
 * `tui/launch.tsx`) — BACKLOG-TECNICO § 2.1, aberto há três meses. Comentário
 * não segura invariante; teste segura.
 *
 * O recorte é `src/app/`, não um arquivo só: a regra de 300 linhas obriga a
 * fatiar o app layer (manager / planner / validator / policy), e `tui/state.ts`
 * chegou a 900 linhas por ignorar isso. O que precisa ser barrado são as
 * superfícies externas — `cli/`, `tui/`, `tools/`, `gateway/` e o entrypoint do
 * worker.
 */
import { test, expect } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Módulos que só a camada de app pode alcançar. */
const RESTRITOS = [
  'adapters/pg/task-repository',
  'adapters/pg/step-repository',
  'adapters/pg/task-queue',
];

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

/**
 * Quem pode importar: o app layer (dono da regra), o próprio `adapters/pg`
 * (a fila reusa `TASK_COLS`/`mapTaskRow` do repositório) e testes — que não
 * são superfície de produção.
 */
function permitido(rel: string): boolean {
  const norm = rel.split(sep).join('/');
  if (/\.test\.tsx?$/.test(norm)) return true;
  return norm.startsWith('app/') || norm.startsWith('adapters/pg/');
}

function importaRestrito(conteudo: string): string | null {
  for (const alvo of RESTRITOS) {
    if (conteudo.includes(alvo)) return alvo;
  }
  return null;
}

// 30s: o teste lê o src/ inteiro e o NTFS é lento. Honesto sobre o custo de IO
// em vez de deixar a suíte vermelha por motivo errado (BACKLOG-TECNICO § 11.1).
test('nenhuma superfície fora de src/app importa os repositórios de task', () => {
  const infratores: string[] = [];
  for (const file of arquivosFonte(SRC)) {
    const rel = relative(SRC, file);
    if (permitido(rel)) continue;
    const alvo = importaRestrito(readFileSync(file, 'utf8'));
    if (alvo) infratores.push(`${rel.split(sep).join('/')} → ${alvo}`);
  }
  // Mensagem nomeia o infrator: quem quebrar precisa saber o que fazer.
  expect(infratores, `passe pelo TaskManager em vez de importar direto:\n  ${infratores.join('\n  ')}`).toEqual([]);
}, 30_000);

test('o gate enxerga uma violação plantada — senão não prova nada', () => {
  // Um teste de fronteira que nunca falha é decoração. Este confere o detector.
  expect(importaRestrito("import { x } from '../adapters/pg/task-repository.js';")).toBe(
    'adapters/pg/task-repository',
  );
  expect(importaRestrito("import { y } from '../adapters/pg/session-repository.js';")).toBeNull();
  expect(permitido(join('cli', 'commands', 'task.ts'))).toBe(false);
  expect(permitido(join('app', 'task-manager.ts'))).toBe(true);
});
