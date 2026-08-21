import { spawn } from 'node:child_process';
import { brand } from '../brand.js';
import { readFileSync } from 'node:fs';
import { planPath, stripFence } from './plan-delegate.js';
import {
  PLAN_ENGINE,
  engineArgs,
  engineMissingError,
  resolveEngineBin,
  type Engine,
} from './exec-engines.js';
import { HARNESS_RULES_REL } from './harness.js';

/**
 * Triagem headless: roda o engine pensante sobre o `plan.md` + o repo e devolve um
 * sim/não sobre precisar de spec SDD antes de implementar. Não escreve spec nem código.
 */

export interface ValidateResult {
  ok: boolean;
  needsSpec?: boolean;
  reason?: string;
  suggestedSlug?: string;
  engine: Engine;
  error?: string;
}

const SLUG_MAX = 50;
const SLUG_FALLBACK = 'plan';

/** Slug git-safe do título do plano p/ o Studio nomear o worktree; degenerado → fallback. Puro. */
export function suggestSlug(plan: string): string {
  const heading = /^#{1,6}\s+(.+?)\s*$/m.exec(plan)?.[1];
  const title = (heading ?? plan.split('\n').find((l) => l.trim()) ?? '').trim();
  const slug = title
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, '');
  return slug || SLUG_FALLBACK;
}

export function planMissingError(project: string): string {
  return `plan.md não encontrado em ${project} — rode \`${brand.name} plan\` antes de validar`;
}

/** Lê o `plan.md` da raiz; ausente/vazio dispara — o caller vira em erro tratado. */
export function readPlan(project: string): string {
  const content = readFileSync(planPath(project), 'utf8');
  if (!content.trim()) throw new Error('plan.md vazio');
  return content;
}

/** Preâmbulo de triagem: ancora no harness e pede veredito + justificativa parseáveis. */
export function buildValidatePrompt(plan: string): string {
  return [
    'Você está TRIANDO um plano — não implemente nada, não escreva código, não edite arquivos.',
    `Antes: leia AGENTS.md e ${HARNESS_RULES_REL} deste projeto e respeite o harness.`,
    'Julgue a COMPLEXIDADE do plano frente ao IMPACTO REAL no código deste repositório:',
    'plano amplo/abrangente (muitos módulos, decisões de arquitetura, risco) MERECE uma spec SDD antes;',
    'plano pequeno/localizado pode ir direto para a implementação.',
    'Responda APENAS neste formato, sem cercas de código:',
    'VERDICT: yes|no',
    'REASON: <uma ou duas frases legíveis explicando o porquê>',
    'yes = precisa de spec antes; no = pode implementar direto.',
    '',
    '## Plano (plan.md)',
    plan,
  ].join('\n');
}

/** Normaliza a resposta do engine em `{ needsSpec, reason }`; ambíguo → dispara. */
export function parseVerdict(text: string): { needsSpec: boolean; reason: string } {
  const clean = stripFence(text);
  const m = /^[ \t]*VERDICT:[ \t]*(yes|no)\b[ \t]*(.*)$/im.exec(clean);
  if (!m) throw new Error('veredito ambíguo: falta a linha `VERDICT: yes|no`');
  const needsSpec = m[1].toLowerCase() === 'yes';
  const rest = clean.replace(m[0], '').trim();
  const reason = (rest || m[2].trim())
    .replace(/^[ \t]*REASON:[ \t]*/i, '')
    .replace(/^[\s—:-]+/, '')
    .trim();
  if (!reason) throw new Error('veredito ambíguo: sem justificativa (reason vazio)');
  return { needsSpec, reason };
}

function spawnValidate(
  bin: string,
  engine: Engine,
  prompt: string,
  project: string,
  echo: boolean,
): Promise<ValidateResult> {
  return new Promise((resolve) => {
    const child = spawn(bin, engineArgs(engine, prompt), {
      cwd: project,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => echo && process.stderr.write(d.toString()));

    const fail = (error: string): void => resolve({ ok: false, engine, error });
    child.on('error', (e) => fail(e.message));
    child.on('close', (code) => {
      if (code !== 0) return fail(`engine ${engine} falhou (exit ${code})`);
      try {
        resolve({ ok: true, engine, ...parseVerdict(out) });
      } catch (e) {
        fail((e as Error).message);
      }
    });
  });
}

/** Bloqueante: lê o plano, roda o engine pensante e devolve o veredito. `echo` streama log. */
export async function runValidatePlan(opts: {
  project: string;
  engine?: Engine;
  echo?: boolean;
}): Promise<ValidateResult> {
  const engine = opts.engine ?? PLAN_ENGINE;
  let plan: string;
  try {
    plan = readPlan(opts.project);
  } catch {
    return { ok: false, engine, error: planMissingError(opts.project) };
  }
  const bin = resolveEngineBin(engine);
  if (!bin) return { ok: false, engine, error: engineMissingError(engine) };
  const result = await spawnValidate(bin, engine, buildValidatePrompt(plan), opts.project, opts.echo === true);
  if (result.ok && result.needsSpec) result.suggestedSlug = suggestSlug(plan);
  return result;
}
