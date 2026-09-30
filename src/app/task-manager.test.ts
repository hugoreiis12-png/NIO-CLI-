/**
 * Ciclo de vida da task sem banco: repos e fila são injetados. Cobre o que a
 * fatia 1.5 promete — criar, resolver por prefixo, exibir e cancelar.
 */
import { test, expect } from 'bun:test';
import type {
  NewStepInput,
  NewTaskInput,
  StepRepository,
  Task,
  TaskQueue,
  TaskRepository,
  TaskStep,
} from '../core/tasks.js';
import type { StepStatus, TaskStatus } from '../core/types.js';
import {
  AmbiguousTaskError,
  TaskManager,
  TaskNotCancellableError,
  TaskNotFoundError,
  TaskNotAwaitingError,
  TaskAwaitsAnswerError,
  numberSteps,
  STEP_GAP,
} from './task-manager.js';

const ENCERRADAS: TaskStatus[] = ['completed', 'failed', 'cancelled'];

function fakeTask(id: string, status: TaskStatus = 'pending'): Task {
  return {
    id,
    sessionId: null,
    userId: 1,
    profile: 'qa',
    goal: 'objetivo',
    status,
    currentStep: null,
    maxSteps: 25,
    workingSet: {},
    engineSessionId: null,
    result: null,
    error: null,
    attempts: 0,
    fence: 0,
    lockedBy: null,
    lockedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: null,
    awaitingKind: null,
    awaitingSubject: null,
    approvedTools: [],
    kind: 'agent',
  };
}

function fakeStep(stepNumber: number, name: string, status: StepStatus = 'pending'): TaskStep {
  return {
    id: stepNumber,
    taskId: 'abc12345',
    stepNumber,
    attempt: 1,
    name,
    status,
    input: null,
    output: null,
    toolCalls: null,
    tokensIn: null,
    tokensOut: null,
    error: null,
    startedAt: null,
    completedAt: null,
    awaitingKind: null,
    awaitingSubject: null,
    approvedTools: [],
    kind: 'agent',
  };
}

/** Repo em memória — só o que o manager usa. */
function fakeRepo(tasks: Task[]): { repo: TaskRepository; criadas: NewTaskInput[] } {
  const criadas: NewTaskInput[] = [];
  const repo: TaskRepository = {
    async create(input) {
      criadas.push(input);
      const t = { ...fakeTask(`novo-${criadas.length}`), ...input };
      tasks.push(t as Task);
      return t as Task;
    },
    async findById(id) {
      return tasks.find((t) => t.id === id) ?? null;
    },
    async listByUser(userId, opts) {
      const doUsuario = tasks.filter((t) => t.userId === userId);
      return opts?.kinds ? doUsuario.filter((t) => opts.kinds!.includes(t.kind)) : doUsuario;
    },
    async setStatus() {
      return true;
    },
    async complete() {
      return true;
    },
    async fail() {
      return true;
    },
    approve: async (id) => {
      const t = tasks.find((x) => x.id === id);
      if (!t || t.status !== 'waiting_approval') return false;
      t.status = 'pending';
      return true;
    },
    async cancel(id) {
      const t = tasks.find((x) => x.id === id);
      if (!t || ENCERRADAS.includes(t.status)) return false;
      t.status = 'cancelled';
      return true;
    },
  };
  return { repo, criadas };
}

function fakeSteps(steps: TaskStep[] = []): StepRepository {
  return {
    async insertAll(_taskId, novos: readonly NewStepInput[]) {
      return novos.map((s) => ({ ...fakeStep(s.stepNumber, s.name), taskId: _taskId }));
    },
    async listByTask() {
      return steps;
    },
    async nextPending() {
      return steps.find((s) => s.status === 'pending') ?? null;
    },
    async start() {},
    async finish() {},
    async failStep() {},
    async retry() {
      return steps[0]!;
    },
    async append() {
      return [];
    },
    async lastStepNumber() {
      return steps.length * STEP_GAP;
    },
  };
}

function fakeQueue(contador: { notificou: number }): TaskQueue {
  return {
    async claim() {
      return null;
    },
    async heartbeat() {
      return true;
    },
    async release() {},
    async reclaimExpired() {
      return 0;
    },
    async notifyNew() {
      contador.notificou++;
    },
    async waitForNew() {},
  };
}

test('create persiste e acorda o worker', async () => {
  const { repo, criadas } = fakeRepo([]);
  const contador = { notificou: 0 };
  const mgr = new TaskManager(repo, fakeSteps(), fakeQueue(contador));

  await mgr.create({ userId: 1, sessionId: null, profile: 'bi', goal: 'analisar contratos' });

  expect(criadas).toHaveLength(1);
  expect(criadas[0]!.goal).toBe('analisar contratos');
  // Sem o NOTIFY o worker só pegaria a task no próximo poll.
  expect(contador.notificou).toBe(1);
});

test('resolve por prefixo: único acha, nenhum e ambíguo lançam tipado', async () => {
  const { repo } = fakeRepo([fakeTask('abc12345'), fakeTask('abc99999'), fakeTask('def00000')]);
  const mgr = new TaskManager(repo, fakeSteps(), fakeQueue({ notificou: 0 }));

  expect((await mgr.resolve(1, 'def')).id).toBe('def00000');
  await expect(mgr.resolve(1, 'zzz')).rejects.toBeInstanceOf(TaskNotFoundError);
  await expect(mgr.resolve(1, 'abc')).rejects.toBeInstanceOf(AmbiguousTaskError);
  // Prefixo vazio não pode devolver "a primeira" por acidente.
  await expect(mgr.resolve(1, '   ')).rejects.toBeInstanceOf(TaskNotFoundError);
});

test('resolve não cruza usuário', async () => {
  const minha = fakeTask('abc11111');
  const alheia = { ...fakeTask('abc22222'), userId: 2 };
  const { repo } = fakeRepo([minha, alheia]);
  const mgr = new TaskManager(repo, fakeSteps(), fakeQueue({ notificou: 0 }));

  // Prefixo ambíguo no banco, mas só uma é do usuário 1.
  expect((await mgr.resolve(1, 'abc')).id).toBe('abc11111');
});

test('show devolve a task com a trilha', async () => {
  const steps = [fakeStep(10, 'localizar', 'done')];
  const { repo } = fakeRepo([fakeTask('abc12345')]);
  const mgr = new TaskManager(repo, fakeSteps(steps), fakeQueue({ notificou: 0 }));

  const { task, steps: trilha } = await mgr.show(1, 'abc');
  expect(task.id).toBe('abc12345');
  expect(trilha).toHaveLength(1);
});

test('cancel: viva cancela, encerrada lança', async () => {
  const { repo } = fakeRepo([fakeTask('viva11111'), fakeTask('morta2222', 'completed')]);
  const mgr = new TaskManager(repo, fakeSteps(), fakeQueue({ notificou: 0 }));

  expect((await mgr.cancel(1, 'viva')).status).toBe('cancelled');
  await expect(mgr.cancel(1, 'morta')).rejects.toBeInstanceOf(TaskNotCancellableError);
});

test('approve libera a tool que travou e devolve à fila', async () => {
  const travada: Task = {
    ...fakeTask('trav1111', 'waiting_approval'),
    awaitingKind: 'approval',
    awaitingSubject: 'bash',
  };
  const { repo } = fakeRepo([travada]);
  const contador = { notificou: 0 };
  const mgr = new TaskManager(repo, fakeSteps(), fakeQueue(contador));

  const t = await mgr.approve(1, 'trav');
  expect(t.status).toBe('pending');
  expect(t.approvedTools).toContain('bash');
  // Sem o NOTIFY a task só voltaria a rodar no próximo poll do worker.
  expect(contador.notificou).toBe(1);
});

test('approve recusa task que não está esperando nada', async () => {
  const { repo } = fakeRepo([fakeTask('rod11111', 'running')]);
  const mgr = new TaskManager(repo, fakeSteps(), fakeQueue({ notificou: 0 }));
  await expect(mgr.approve(1, 'rod')).rejects.toBeInstanceOf(TaskNotAwaitingError);
});

test('approve recusa quando a trava é pergunta, não permissão', async () => {
  const comPergunta: Task = {
    ...fakeTask('perg1111', 'waiting_approval'),
    awaitingKind: 'question',
    awaitingSubject: 'qual banco?',
  };
  const { repo } = fakeRepo([comPergunta]);
  const mgr = new TaskManager(repo, fakeSteps(), fakeQueue({ notificou: 0 }));
  // Aprovar não responde a pergunta: a task voltaria à fila e estacionaria no
  // mesmo ponto. Prometer uma destrava que não destrava é pior que recusar.
  await expect(mgr.approve(1, 'perg')).rejects.toBeInstanceOf(TaskAwaitsAnswerError);
});

test('numberSteps deixa folga pra inserir no meio', () => {
  const steps = numberSteps([{ name: 'a' }, { name: 'b' }, { name: 'c' }]);
  expect(steps.map((s) => s.stepNumber)).toEqual([10, 20, 30]);
  // Append depois do último: continua sem colidir.
  expect(numberSteps([{ name: 'd' }], 30).map((s) => s.stepNumber)).toEqual([40]);
});
