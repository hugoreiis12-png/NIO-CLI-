import { brand } from '../../brand.js';
import { readFileSync } from 'node:fs';
import { planPath, stripFence } from './plan-delegate.js';
import { QWEN_ENGINE, qwenComplete } from './qwen-client.js';
import { HARNESS_RULES_REL } from '../clients/harness.js';

/**
 * Triagem headless: roda o **Qwen vLLM local** (API direta, sem binário externo)
 * sobre o `plan.md` + o repo e devolve um sim/não sobre precisar de spec SDD antes
 * de implementar. Não escreve spec nem código.
 */

export interface ValidateResult {
  ok: boolean;
  needsSpec?: boolean;
  reason?: string;
  suggestedSlug?: string;
  engine: string;
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

/** Normaliza a resposta do Qwen em `{ needsSpec, reason }`; ambíguo → dispara. */
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

async function apiValidate(prompt: string, project: string, echo: boolean): Promise<ValidateResult> {
  try {
    const out = await qwenComplete(prompt);
    if (echo) process.stderr.write(out);
    return { ok: true, engine: QWEN_ENGINE, ...parseVerdict(out) };
  } catch (e) {
    return { ok: false, engine: QWEN_ENGINE, error: (e as Error).message };
  }
}

/** Bloqueante: lê o plano, roda o Qwen e devolve o veredito. `echo` streama log. */
export async function runValidatePlan(opts: {
  project: string;
  echo?: boolean;
}): Promise<ValidateResult> {
  let plan: string;
  try {
    plan = readPlan(opts.project);
  } catch {
    return { ok: false, engine: QWEN_ENGINE, error: planMissingError(opts.project) };
  }
  const result = await apiValidate(buildValidatePrompt(plan), opts.project, opts.echo === true);
  if (result.ok && result.needsSpec) result.suggestedSlug = suggestSlug(plan);
  return result;
}