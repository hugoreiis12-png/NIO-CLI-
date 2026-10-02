/**
 * Registra um turno da TUI como task `chat` — mesma trilha, mesma política e
 * mesma memória do worker, sem passar pelo Planner (a mensagem do usuário JÁ é
 * a instrução; planejar um "oi" seria absurdo).
 *
 * **Tudo aqui é best-effort e nunca lança.** Registrar é acessório: um Postgres
 * fora do ar não pode derrubar o chat, exatamente como o aprendizado de lições
 * (`learnTurn`) já é tratado na TUI. Falhou → devolve `null` e a vida segue.
 *
 * Execução: se BAIXA intensidade, a TUI executa em processo com humano na frente
 * e a task nasce `running` — a fila só enxerga `pending`, então o worker não
 * disputa um turno vivo. Se ALTA intensidade, `delegateTurn` reabre o step e
 * devolve a task à fila (`pending` + `current_step`), e o `nio-worker` a
 * reivindica e executa headless sem replanejar.
 */
import type { StepRepository, TaskQueue, TaskRepository, ToolCallTrace } from '../core/tasks.js';
import type { Profile } from '../core/types.js';
import { createTaskRepository } from '../adapters/pg/task-repository.js';
import { createStepRepository } from '../adapters/pg/step-repository.js';
import { createTaskQueue } from '../adapters/pg/task-queue.js';
import { STEP_GAP } from './task-manager.js';

/** Teto do texto que vira `goal`/`name`. Colunas são TEXT, mas listagem não é. */
const RESUMO_MAX = 120;

export interface TurnRef {
  taskId: string;
  stepId: number;
}

export interface TurnTaskDeps {
  tasks?: TaskRepository;
  steps?: StepRepository;
  queue?: TaskQueue;
}

export interface BeginTurnInput {
  userId: number;
  sessionId: string | null;
  profile: Profile;
  /** A mensagem do usuário, crua. */
  text: string;
}

export interface TurnOutcome {
  text: string;
  toolCalls?: ToolCallTrace[];
  tokensIn?: number;
  tokensOut?: number;
}

/** Primeira linha, sem quebra, truncada — o que aparece no `nio task list`. */
export function resumir(texto: string, max = RESUMO_MAX): string {
  const limpo = texto.replace(/\s+/g, ' ').trim();
  if (limpo.length <= max) return limpo;
  return `${limpo.slice(0, max - 1)}…`;
}

/** Abre a task do turno. `null` = não deu pra registrar (e não importa). */
export async function beginTurn(
  input: BeginTurnInput,
  deps: TurnTaskDeps = {},
): Promise<TurnRef | null> {
  const texto = input.text.trim();
  if (!texto) return null;
  try {
    const tasks = deps.tasks ?? createTaskRepository();
    const steps = deps.steps ?? createStepRepository();
    const task = await tasks.create({
      userId: input.userId,
      sessionId: input.sessionId,
      profile: input.profile,
      goal: resumir(texto),
      kind: 'chat',
      status: 'running',
    });
    const [step] = await steps.insertAll(task.id, [
      { stepNumber: STEP_GAP, name: resumir(texto, 80), input: { instruction: texto } },
    ]);
    if (!step) return null;
    await steps.start(step.id);
    return { taskId: task.id, stepId: step.id };
  } catch {
    return null; // registrar é acessório; o turno continua
  }
}

/**
 * Devolve o turno à fila pro `nio-worker` retomar. `true` = o worker pode
 * reivindicar; `false` = nada mudou e a TUI deve seguir executando local.
 *
 * Ordem importa: o step volta a `pending` ANTES da task, senão o worker poderia
 * reivindicar e achar a trilha sem step pendente.
 */
export async function delegateTurn(
  turnRef: TurnRef,
  engineSessionId: string,
  deps: TurnTaskDeps = {},
): Promise<boolean> {
  try {
    const tasks = deps.tasks ?? createTaskRepository();
    const steps = deps.steps ?? createStepRepository();
    const task = await tasks.findById(turnRef.taskId);
    if (!task) return false;
    await steps.reopen(turnRef.stepId);
    const queued = await tasks.setStatus(task.id, 'pending', task.fence, {
      currentStep: STEP_GAP,
      engineSessionId,
    });
    if (!queued) return false;
    await (deps.queue ?? createTaskQueue()).notifyNew();
    return true;
  } catch {
    return false; // best-effort: a TUI segue local
  }
}

/** Fecha o turno com o que o motor produziu. Silencioso em qualquer falha. */
export async function endTurn(
  ref: TurnRef | null,
  outcome: TurnOutcome,
  deps: TurnTaskDeps = {},
): Promise<void> {
  if (!ref) return;
  try {
    const tasks = deps.tasks ?? createTaskRepository();
    const steps = deps.steps ?? createStepRepository();
    await steps.finish(ref.stepId, {
      output: { text: outcome.text },
      ...(outcome.toolCalls ? { toolCalls: outcome.toolCalls } : {}),
      ...(outcome.tokensIn !== undefined ? { tokensIn: outcome.tokensIn } : {}),
      ...(outcome.tokensOut !== undefined ? { tokensOut: outcome.tokensOut } : {}),
    });
    // `fence` 0: turno local não tem lease — quem executa é a TUI, e a task nasce
    // `running`, fora do alcance do `claim`. Delegado, a TUI larga o ref.
    await tasks.complete(ref.taskId, 0, resumir(outcome.text, 2000));
  } catch {
    /* o turno já foi entregue ao usuário; o registro é que ficou para trás */
  }
}

/** Marca o turno como falho (motor caiu, usuário interrompeu). Nunca lança. */
export async function abortTurn(
  ref: TurnRef | null,
  motivo: string,
  deps: TurnTaskDeps = {},
): Promise<void> {
  if (!ref) return;
  try {
    const tasks = deps.tasks ?? createTaskRepository();
    const steps = deps.steps ?? createStepRepository();
    await steps.failStep(ref.stepId, motivo);
    await tasks.fail(ref.taskId, 0, motivo);
  } catch {
    /* idem */
  }
}
