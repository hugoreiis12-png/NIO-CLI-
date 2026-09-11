import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { QWEN_ENGINE, qwenComplete } from './qwen-client.js';
import { HARNESS_RULES_REL } from '../clients/harness.js';

/**
 * Planejamento headless: roda o **Qwen vLLM local** (API direta, sem binário externo)
 * sobre a raiz do projeto e escreve um `plan.md` de rascunho pré-SDD. Não cria
 * worktree, não toca código, não roda checks.
 */

export interface PlanResult {
  ok: boolean;
  path: string;
  engine: string;
  error?: string;
}

/** Semente pré-SDD: estrutura mínima pro Qwen preencher na primeira rodada. */
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

/** O Qwen às vezes embrulha a resposta em ```markdown — o arquivo não quer a cerca. */
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

async function apiPlan(prompt: string, project: string, echo: boolean): Promise<PlanResult> {
  try {
    const markdown = await qwenComplete(prompt);
    if (echo) process.stderr.write(markdown);
    const content = stripFence(markdown);
    if (!content) {
      return {
        ok: false,
        path: planPath(project),
        engine: QWEN_ENGINE,
        error: 'engine não devolveu markdown',
      };
    }
    return { ok: true, path: writeAtomic(project, content), engine: QWEN_ENGINE };
  } catch (e) {
    return {
      ok: false,
      path: planPath(project),
      engine: QWEN_ENGINE,
      error: (e as Error).message,
    };
  }
}

/** Bloqueante: roda o Qwen e escreve o `plan.md`. `echo` streama log no stderr. */
export function runPlan(opts: {
  project: string;
  instruction: string;
  echo?: boolean;
}): Promise<PlanResult> {
  const prompt = buildPlanPrompt(opts.instruction, planBase(opts.project));
  return apiPlan(prompt, opts.project, opts.echo === true);
}