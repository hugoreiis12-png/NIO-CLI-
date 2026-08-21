import { spawn } from 'node:child_process';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PLAN_ENGINE,
  engineArgs,
  engineMissingError,
  resolveEngineBin,
  type Engine,
} from './exec-engines.js';
import { HARNESS_RULES_REL } from './harness.js';

/**
 * Planejamento headless: roda o engine pensante sobre a raiz do projeto e escreve um
 * `plan.md` de rascunho pré-SDD. Não cria worktree, não toca código, não roda checks.
 */

export interface PlanResult {
  ok: boolean;
  path: string;
  engine: Engine;
  error?: string;
}

/** Semente pré-SDD: estrutura mínima pro engine preencher na primeira rodada. */
export const PLAN_TEMPLATE = [
  '# Plano',
  '',
  '## Contexto',
  '',
  '## Problema',
  '',
  '## Solução',
  '',
  '## Escopo',
  '',
  '### Fora de escopo',
  '',
  '## Decisões',
  '',
  '## Tarefas',
  '',
].join('\n');

export function planPath(project: string): string {
  return join(project, 'plan.md');
}

/** Base do refino: conteúdo atual do `plan.md`, ou o template quando ainda não existe. */
export function planBase(project: string): string {
  try {
    const current = readFileSync(planPath(project), 'utf8');
    return current.trim() ? current : PLAN_TEMPLATE;
  } catch {
    return PLAN_TEMPLATE;
  }
}

/** Preâmbulo de planejamento: ancora no harness e proíbe explicitamente escrever código. */
export function buildPlanPrompt(instruction: string, base: string): string {
  return [
    'Você está RASCUNHANDO/REFINANDO um plano — não implemente nada.',
    `Antes: leia AGENTS.md e ${HARNESS_RULES_REL} deste projeto e respeite o harness.`,
    'NÃO escreva código, NÃO edite arquivos, NÃO rode comandos.',
    'Parta do plano atual abaixo e refine-o à luz da instrução; não descarte raciocínio já feito.',
    'Responda APENAS com o markdown final do plan.md, sem cercas de código e sem comentários.',
    '',
    `## Instrução`,
    instruction,
    '',
    '## Plano atual',
    base,
  ].join('\n');
}

/** O engine às vezes embrulha a resposta em ```markdown — o arquivo não quer a cerca. */
export function stripFence(text: string): string {
  const t = text.trim();
  const m = /^```[a-zA-Z]*\n([\s\S]*?)\n?```$/.exec(t);
  return (m ? m[1] : t).trim();
}

/** Write-then-rename: o plano anterior sobrevive até a escrita concluir. */
function writeAtomic(project: string, content: string): string {
  const target = planPath(project);
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, `${content}\n`, 'utf8');
  renameSync(tmp, target);
  return target;
}

function spawnPlan(
  bin: string,
  engine: Engine,
  prompt: string,
  project: string,
  echo: boolean,
): Promise<PlanResult> {
  return new Promise((resolve) => {
    const child = spawn(bin, engineArgs(engine, prompt), {
      cwd: project,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let markdown = '';
    child.stdout.on('data', (d: Buffer) => (markdown += d.toString()));
    child.stderr.on('data', (d: Buffer) => echo && process.stderr.write(d.toString()));

    const fail = (error: string): void => {
      resolve({ ok: false, path: planPath(project), engine, error });
    };
    child.on('error', (e) => fail(e.message));
    child.on('close', (code) => {
      if (code !== 0) return fail(`engine ${engine} falhou (exit ${code})`);
      const content = stripFence(markdown);
      if (!content) return fail(`engine ${engine} não devolveu markdown`);
      resolve({ ok: true, path: writeAtomic(project, content), engine });
    });
  });
}

/** Bloqueante: roda o engine pensante e escreve o `plan.md`. `echo` streama log no stderr. */
export function runPlan(opts: {
  project: string;
  instruction: string;
  engine?: Engine;
  echo?: boolean;
}): Promise<PlanResult> {
  const engine = opts.engine ?? PLAN_ENGINE;
  const bin = resolveEngineBin(engine);
  if (!bin) {
    return Promise.resolve({
      ok: false,
      path: planPath(opts.project),
      engine,
      error: engineMissingError(engine),
    });
  }
  const prompt = buildPlanPrompt(opts.instruction, planBase(opts.project));
  return spawnPlan(bin, engine, prompt, opts.project, opts.echo === true);
}
