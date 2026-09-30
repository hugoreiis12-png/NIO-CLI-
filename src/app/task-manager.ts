/**
 * `TaskManager` — camada de app do ciclo de vida da `Task`. É o ponto **único**
 * por onde CLI, TUI, tools MCP e o worker falam com `tasks`/`task_steps`:
 * nenhuma superfície fora de `src/app/` importa os repositórios direto.
 *
 * Isso não é promessa de comentário — `task-boundary.test.ts` falha o build se
 * alguém furar. O `SessionManager` faz a mesma declaração desde 2026-06 e está
 * furado em 7 pontos (BACKLOG-TECNICO § 2.1) justamente por não ter esse teste.
 *
 * Sem IO direto: repos e fila são injetáveis (default = implementações reais),
 * então o ciclo de vida é testável sem banco.
 */
import type { Profile } from '../core/types.js';
import type {
  ListTasksOpts,
  NewStepInput,
  StepRepository,
  Task,
  TaskQueue,
  TaskRepository,
  TaskStep,
} from '../core/tasks.js';
import { createTaskRepository } from '../adapters/pg/task-repository.js';
import { createStepRepository } from '../adapters/pg/step-repository.js';
import { createTaskQueue } from '../adapters/pg/task-queue.js';

/** Nenhuma task do usuário casa com o prefixo pedido. */
export class TaskNotFoundError extends Error {
  constructor(prefix: string) {
    super(`Nenhuma task começa com "${prefix}".`);
    this.name = 'TaskNotFoundError';
  }
}

/** Mais de uma task casa com o prefixo — precisa de mais caracteres. */
export class AmbiguousTaskError extends Error {
  constructor(
    prefix: string,
    readonly count: number,
  ) {
    super(`Ambíguo: ${count} tasks começam com "${prefix}". Use mais caracteres.`);
    this.name = 'AmbiguousTaskError';
  }
}

/** Aprovar só faz sentido em `waiting_approval`. */
export class TaskNotAwaitingError extends Error {
  constructor(id: string, status: string) {
    super(`A task ${id.slice(0, 8)} está "${status}" — não há nada esperando aprovação.`);
    this.name = 'TaskNotAwaitingError';
  }
}

/** Parou numa pergunta do motor: aprovar não responde, então não destrava. */
export class TaskAwaitsAnswerError extends Error {
  constructor(readonly pergunta: string) {
    super(
      `A task parou numa pergunta do motor ("${pergunta}"), não numa permissão. ` +
        'Responder perguntas em modo headless ainda não é suportado — cancele e refaça o objetivo mais específico.',
    );
    this.name = 'TaskAwaitsAnswerError';
  }
}

/** Task já encerrada não volta atrás — cancelar uma é erro do chamador. */
export class TaskNotCancellableError extends Error {
  constructor(id: string, status: string) {
    super(`A task ${id.slice(0, 8)} já está "${status}" — não dá pra cancelar.`);
    this.name = 'TaskNotCancellableError';
  }
}

export interface CreateTaskInput {
  userId: number;
  /** Proveniência: de onde a request veio. `null` = fora de sessão. */
  sessionId: string | null;
  profile: Profile;
  goal: string;
  maxSteps?: number;
}

/** Task + sua trilha — o que o `nio task show` renderiza. */
export interface TaskWithSteps {
  task: Task;
  steps: TaskStep[];
}

/** Numeração com folga: deixa espaço pra inserir step no meio sem renumerar. */
export const STEP_GAP = 10;

/** Converte um plano em steps numerados a partir de `fromNumber`. */
export function numberSteps(
  names: readonly { name: string; input?: Record<string, unknown> }[],
  fromNumber = 0,
): NewStepInput[] {
  return names.map((s, i) => ({
    stepNumber: fromNumber + (i + 1) * STEP_GAP,
    name: s.name,
    ...(s.input ? { input: s.input } : {}),
  }));
}

export class TaskManager {
  constructor(
    private readonly repo: TaskRepository = createTaskRepository(),
    private readonly steps: StepRepository = createStepRepository(),
    private readonly queue: TaskQueue = createTaskQueue(),
  ) {}

  /**
   * Cria a task e acorda quem estiver ouvindo. O `NOTIFY` é best-effort: perdê-lo
   * só custa a latência do poll do worker, nunca a task.
   */
  async create(input: CreateTaskInput): Promise<Task> {
    const task = await this.repo.create({
      userId: input.userId,
      sessionId: input.sessionId,
      profile: input.profile,
      goal: input.goal,
      ...(input.maxSteps !== undefined ? { maxSteps: input.maxSteps } : {}),
    });
    await this.queue.notifyNew();
    return task;
  }

  /** Lista para o usuário. Sem `kinds`, mostra só trabalho de agente — turno
   *  de chat encheria a listagem com cada mensagem já digitada. */
  list(userId: number, opts: ListTasksOpts = {}): Promise<Task[]> {
    return this.repo.listByUser(userId, { kinds: ['agent'], ...opts });
  }

  /** Resolve uma task do usuário pelo prefixo do id. Lança se ausente ou ambíguo. */
  async resolve(userId: number, idPrefix: string): Promise<Task> {
    const prefix = idPrefix.trim();
    if (!prefix) throw new TaskNotFoundError('(vazio)');
    // Busca uma página generosa: o prefixo serve pra uso interativo, não pra varrer histórico.
    // Sem recorte de kind: um turno de chat também tem que ser resolvível por prefixo.
    const todas = await this.repo.listByUser(userId, { limit: 200 });
    const matches = todas.filter((t) => t.id.startsWith(prefix));
    if (matches.length === 1) return matches[0]!;
    if (matches.length === 0) throw new TaskNotFoundError(prefix);
    throw new AmbiguousTaskError(prefix, matches.length);
  }

  /** Task + trilha, para exibição. */
  async show(userId: number, idPrefix: string): Promise<TaskWithSteps> {
    const task = await this.resolve(userId, idPrefix);
    return { task, steps: await this.steps.listByTask(task.id) };
  }

  /**
   * Libera a tool que estacionou a task e devolve à fila.
   *
   * Recusa pergunta de propósito: aprovar não responde nada, então a task
   * voltaria à fila só para estacionar no mesmo ponto. Prometer uma destrava
   * que não destrava é pior que dizer que não dá.
   */
  async approve(userId: number, idPrefix: string): Promise<Task> {
    const task = await this.resolve(userId, idPrefix);
    if (task.status !== 'waiting_approval') {
      throw new TaskNotAwaitingError(task.id, task.status);
    }
    if (task.awaitingKind === 'question') {
      throw new TaskAwaitsAnswerError(task.awaitingSubject ?? 'pergunta');
    }
    const tool = task.awaitingSubject;
    if (!tool) throw new TaskNotAwaitingError(task.id, task.status);

    const ok = await this.repo.approve(task.id, userId, tool);
    if (!ok) throw new TaskNotAwaitingError(task.id, task.status);
    await this.queue.notifyNew();
    return { ...task, status: 'pending', approvedTools: [...task.approvedTools, tool] };
  }

  /** Cancela uma task ainda viva. Lança se já terminou. */
  async cancel(userId: number, idPrefix: string): Promise<Task> {
    const task = await this.resolve(userId, idPrefix);
    const ok = await this.repo.cancel(task.id, userId);
    if (!ok) throw new TaskNotCancellableError(task.id, task.status);
    return { ...task, status: 'cancelled' };
  }
}
