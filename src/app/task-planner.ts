/**
 * `Planner` — transforma o `goal` da task numa lista de steps.
 *
 * Fala **direto** no vLLM (`qwenComplete`), sem passar pelo `opencode serve`:
 * planejar é uma chamada single-shot sem tool, e subir o runtime agêntico pra
 * isso seria pagar o custo sem usar nada dele.
 *
 * **Só enxerga o `goal`.** Nenhum conteúdo recuperado (documento analisado,
 * resultado de busca, saída de step) entra aqui — planejar sobre texto de
 * terceiro é o vetor de prompt injection mais direto do sistema. O conteúdo
 * externo só aparece nos steps de execução, onde a `ApprovalPolicy` gateia.
 */
import { z } from 'zod';
import type { Planner, PlannedStep } from '../core/agent.js';
import type { Task } from '../core/tasks.js';
import { qwenComplete, type QwenRequestOpts } from '../lib/exec/qwen-client.js';
import { parseLlmJson } from './llm-json.js';

/** Piso e teto do plano inicial. Um step só não é plano; 12 já é micro-gerência. */
const MIN_STEPS = 1;
const MAX_PLAN_STEPS = 12;

const PlanSchema = z.object({
  steps: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        instruction: z.string().min(1).max(2000),
        tool_hint: z.string().max(80).optional(),
      }),
    )
    .min(MIN_STEPS),
});

const SYSTEM = [
  'Você planeja a execução de uma tarefa de engenharia em passos discretos.',
  'Responda SOMENTE com JSON no formato:',
  '{"steps":[{"name":"...","instruction":"...","tool_hint":"..."}]}',
  '',
  'Regras:',
  `- No máximo ${MAX_PLAN_STEPS} passos. Prefira menos passos maiores a muitos triviais.`,
  '- `name` é um rótulo curto (até 80 chars). `instruction` é o que executar, em uma ou duas frases.',
  '- `tool_hint` é opcional: o nome provável da ferramenta (ex.: `read`, `nio_fabric_query`).',
  '- Cada passo deve ser verificável: alguém olhando a saída sabe dizer se deu certo.',
  '- Não inclua passos de "revisar" ou "validar o resultado" — isso é feito depois, por outro componente.',
].join('\n');

export interface PlannerDeps {
  /** Injetável pro teste — default é o vLLM real. */
  complete?: (prompt: string, opts?: QwenRequestOpts) => Promise<string>;
}

/**
 * Monta o prompt. Recebe `goal` e `profile` como dados, nunca como instrução:
 * o perfil só informa o contexto técnico, não muda as regras do plano.
 */
export function buildPlanPrompt(goal: string, profile: string, maxSteps: number): string {
  const teto = Math.min(MAX_PLAN_STEPS, maxSteps);
  return [
    `Perfil do ambiente: ${profile}`,
    `Limite de passos: ${teto}`,
    '',
    'Objetivo do usuário:',
    goal,
  ].join('\n');
}

/** Corta o plano no teto da task — o modelo às vezes ignora o limite do prompt. */
export function clampSteps(steps: readonly PlannedStep[], maxSteps: number): PlannedStep[] {
  const teto = Math.max(MIN_STEPS, Math.min(MAX_PLAN_STEPS, maxSteps));
  return steps.slice(0, teto);
}

export function createTaskPlanner(deps: PlannerDeps = {}): Planner {
  const complete = deps.complete ?? qwenComplete;
  return {
    async plan(task: Task): Promise<PlannedStep[]> {
      const resposta = await complete(buildPlanPrompt(task.goal, task.profile, task.maxSteps), {
        system: SYSTEM,
        temperature: 0.2, // plano é determinístico por natureza; criatividade aqui atrapalha
      });
      const { steps } = parseLlmJson(resposta, PlanSchema);
      return clampSteps(
        steps.map((s) => ({
          name: s.name,
          instruction: s.instruction,
          ...(s.tool_hint ? { toolHint: s.tool_hint } : {}),
        })),
        task.maxSteps,
      );
    },
  };
}
