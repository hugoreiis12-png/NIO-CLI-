/**
 * O laço do worker, com banco e motor falsos. O foco são as transições que, se
 * erradas, corrompem a execução em silêncio: step com halt marcado como `done`,
 * escrita após perder o lease, e `INCOMPLETE` virando loop infinito.
 */
import { test, expect } from 'bun:test';
import { TaskRunner } from './task-runner.js';
import type { Planner, StepExecutor, StepOutcome, Validator, Verdict } from '../core/agent.js';
import type {
  NewStepInput,
  StepRepository,
  Task,
  TaskQueue,
  TaskRepository,
  TaskStep,
} from '../core/tasks.js';
import type { TaskStatus } from '../core/types.js';

function novaTask(status: TaskStatus = 'planning'): Task {
  return {
    id: 't1',
    sessionId: null,
    userId: 7,
    profile: 'qa',
    goal: 'contar arquivos',
    status,
    currentStep: null,
    maxSteps: 25,
    workingSet: {},
    engineSessionId: null,
    result: null,
    error: null,
    attempts: 0,
    fence: 1,
    lockedBy: 'w1',
    lockedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: null,
    awaitingKind: null,
    awaitingSubject: null,
    approvedTools: [],
    kind: 'agent',
  };
}

interface Mundo {
  task: Task;
  steps: TaskStep[];
  leaseVivo: boolean;
  eventos: string[];
}

function criarMundo(status: TaskStatus = 'planning'): Mundo {
  return { task: novaTask(status), steps: [], leaseVivo: true, eventos: [] };
}

function fakeRepos(m: Mundo): { tasks: TaskRepository; steps: StepRepository; queue: TaskQueue } {
  let proximoId = 1;
  const inserir = (novos: readonly NewStepInput[]): TaskStep[] =>
    novos.map((s) => {
      const step: TaskStep = {
        id: proximoId++,
        taskId: m.task.id,
        stepNumber: s.stepNumber,
        attempt: 1,
        name: s.name,
        status: 'pending',
        input: s.input ?? null,
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
      m.steps.push(step);
      return step;
    });
  const acharStep = (id: number): TaskStep | undefined => m.steps.find((s) => s.id === id);
  /** Só grava se o fence bater — espelha a guarda real do Postgres. */
  const comFence = (fence: number, fn: () => void): boolean => {
    if (fence !== m.task.fence) return false;
    fn();
    return true;
  };

  return {
    tasks: {
      create: async () => m.task,
      findById: async () => m.task,
      listByUser: async () => [m.task],
      setStatus: async (_id, status, fence, patch) =>
        comFence(fence, () => {
          m.task.status = status;
          if (patch?.currentStep !== undefined) m.task.currentStep = patch.currentStep;
          if (patch?.engineSessionId !== undefined) m.task.engineSessionId = patch.engineSessionId;
          if (patch?.error !== undefined) m.task.error = patch.error;
          if (patch?.awaitingKind !== undefined) m.task.awaitingKind = patch.awaitingKind;
          if (patch?.awaitingSubject !== undefined) m.task.awaitingSubject = patch.awaitingSubject;
        }),
      complete: async (_id, fence, result) =>
        comFence(fence, () => {
          m.task.status = 'completed';
          m.task.result = result;
        }),
      fail: async (_id, fence, error) =>
        comFence(fence, () => {
          m.task.status = 'failed';
          m.task.error = error;
        }),
      approve: async () => true,
      cancel: async () => true,
    },
    steps: {
      insertAll: async (_t, novos) => inserir(novos),
      append: async (_t, novos) => inserir(novos),
      listByTask: async () => m.steps,
      nextPending: async () => m.steps.find((s) => s.status === 'pending') ?? null,
      start: async (id) => {
        const s = acharStep(id);
        if (s) s.status = 'running';
      },
      reopen: async (id) => {
        const s = acharStep(id);
        if (s?.status === 'running') s.status = 'pending';
      },
      finish: async (id, r) => {
        const s = acharStep(id);
        if (s) {
          s.status = 'done';
          s.output = r.output;
        }
      },
      failStep: async (id, error) => {
        const s = acharStep(id);
        if (s) {
          s.status = 'failed';
          s.error = error;
        }
      },
      retry: async (id) => acharStep(id)!,
      lastStepNumber: async () => Math.max(0, ...m.steps.map((s) => s.stepNumber)),
    },
    queue: {
      claim: async () => m.task,
      // `false` = lease perdido; o runner tem que parar de escrever.
      heartbeat: async () => m.leaseVivo,
      release: async () => {},
      reclaimExpired: async () => 0,
      notifyNew: async () => {},
      waitForNew: async () => {},
    },
  };
}

const planoDe = (...nomes: string[]): Planner => ({
  plan: async () => nomes.map((name) => ({ name, instruction: `faça ${name}` })),
});

const executorQue = (fn: (step: TaskStep) => StepOutcome): StepExecutor => ({
  run: async (_t, step) => fn(step),
});

const OK: StepOutcome = { output: { text: 'ok' }, toolCalls: [], tokensIn: 1, tokensOut: 1 };

const validadorQue = (...vereditos: Verdict[]): Validator => {
  let i = 0;
  return { judge: async () => vereditos[Math.min(i++, vereditos.length - 1)]! };
};

const concluiu: Verdict = { complete: true, result: 'pronto' };

function montar(
  m: Mundo,
  planner: Planner,
  validator: Validator,
  executor: StepExecutor,
): TaskRunner {
  const { tasks, steps, queue } = fakeRepos(m);
  return new TaskRunner({
    planner,
    validator,
    executor,
    tasks,
    steps,
    queue,
    heartbeatMs: 5,
    onEvent: (e) => m.eventos.push(e),
  });
}

test('caminho feliz: planeja, executa tudo, valida e conclui', async () => {
  const m = criarMundo();
  const runner = montar(
    m,
    planoDe('a', 'b'),
    validadorQue(concluiu),
    executorQue(() => OK),
  );

  expect(await runner.runOnce('w1', 7)).toBe(true);
  expect(m.task.status).toBe('completed');
  expect(m.task.result).toBe('pronto');
  expect(m.steps.every((s) => s.status === 'done')).toBe(true);
  expect(m.eventos).toContain('task_planned');
  expect(m.eventos).toContain('task_completed');
});

test('halt de aprovação: task estaciona e o step SEGUE pendente (retomável)', async () => {
  const m = criarMundo();
  const halt = {
    ...OK,
    halt: { kind: 'approval' as const, subject: 'bash', reason: 'precisa humano' },
  };
  const runner = montar(
    m,
    planoDe('a', 'b'),
    validadorQue(concluiu),
    executorQue(() => halt),
  );

  await runner.runOnce('w1', 7);
  expect(m.task.status).toBe('waiting_approval');
  // O step NÃO pode virar `done` — e fica `pending` para o worker retomar daqui.
  expect(m.steps[0]!.status).toBe('pending');
  expect(m.steps.some((s) => s.status === 'done')).toBe(false);
  // Estacionar não é falhar: sem erro gravado.
  expect(m.task.error).toBeNull();
  // E registra O QUE travou — sem isto o `approve` não teria alvo e a task
  // ficaria num estado que ninguém sabe destravar.
  expect(m.task.awaitingKind).toBe('approval');
  expect(m.task.awaitingSubject).toBe('bash');
});

test('halt de erro do motor: falha com o diagnóstico REAL, não um genérico', async () => {
  // O executor já tentou recuperar sozinho (sessão nova / continuação) e não
  // conseguiu — `reason` carrega o motivo real, diferente do texto fixo do timeout.
  const m = criarMundo();
  const halt = {
    ...OK,
    halt: {
      kind: 'engine_error' as const,
      subject: 'ContextOverflowError',
      reason: 'estouro de contexto — 2 tentativa(s) de recuperação esgotada(s)',
    },
  };
  const runner = montar(
    m,
    planoDe('a'),
    validadorQue(concluiu),
    executorQue(() => halt),
  );

  await runner.runOnce('w1', 7);
  expect(m.task.status).toBe('failed');
  expect(m.task.error).toBe('estouro de contexto — 2 tentativa(s) de recuperação esgotada(s)');
  expect(m.steps[0]!.status).toBe('failed');
});

test('halt de timeout: falha e marca o step, não estaciona', async () => {
  const m = criarMundo();
  const halt = { ...OK, halt: { kind: 'timeout' as const, subject: 'a', reason: 'estourou' } };
  const runner = montar(
    m,
    planoDe('a'),
    validadorQue(concluiu),
    executorQue(() => halt),
  );

  await runner.runOnce('w1', 7);
  expect(m.task.status).toBe('failed');
  expect(m.steps[0]!.status).toBe('failed');
});

test('validator INCOMPLETO com próximos passos: acrescenta e executa de novo', async () => {
  const m = criarMundo();
  const incompleto: Verdict = {
    complete: false,
    reason: 'falta juntar',
    nextSteps: [{ name: 'c', instruction: 'junte' }],
  };
  const runner = montar(
    m,
    planoDe('a'),
    validadorQue(incompleto, concluiu),
    executorQue(() => OK),
  );

  await runner.runOnce('w1', 7);
  expect(m.eventos).toContain('task_extended');
  expect(m.steps).toHaveLength(2);
  // Numeração com folga: o passo novo entra DEPOIS, sem colidir.
  expect(m.steps[1]!.stepNumber).toBeGreaterThan(m.steps[0]!.stepNumber);
  expect(m.task.status).toBe('completed');
});

test('INCOMPLETO sem próximos passos vira falha — não loop infinito', async () => {
  const m = criarMundo();
  const semSaida: Verdict = { complete: false, reason: 'orçamento acabou', nextSteps: [] };
  const runner = montar(
    m,
    planoDe('a'),
    validadorQue(semSaida),
    executorQue(() => OK),
  );

  await runner.runOnce('w1', 7);
  // Era a obrigação herdada da fatia 1.7: o Validator não tem estado de "esgotado".
  expect(m.task.status).toBe('failed');
  expect(m.task.error).toContain('Teto de passos');
  expect(m.eventos).toContain('task_exhausted');
});

test('lease perdido interrompe o processamento na hora', async () => {
  const m = criarMundo();
  const executados: string[] = [];
  const runner = montar(
    m,
    planoDe('a', 'b'),
    validadorQue(concluiu),
    executorQue((step) => {
      executados.push(step.name);
      m.leaseVivo = false; // outro worker assumiu no meio do 1º step
      return OK;
    }),
  );

  await runner.runOnce('w1', 7);

  // Parou no 1º step: seguir para o 2º seria escrever na trilha de outro worker.
  expect(executados).toEqual(['a']);
  expect(m.eventos).toContain('lease_lost');
  // Nem falha nem conclusão: a task não é mais nossa para rotular.
  expect(m.task.status).not.toBe('failed');
  expect(m.task.status).not.toBe('completed');
});

test('escrita com fence velho não afeta nada (guarda do Postgres espelhada)', async () => {
  const m = criarMundo();
  const { tasks } = fakeRepos(m);
  expect(await tasks.setStatus('t1', 'completed', 999)).toBe(false);
  expect(m.task.status).toBe('planning');
});

test('retomada: task já planejada não replaneja', async () => {
  const m = criarMundo('running');
  m.steps.push({
    id: 1,
    taskId: 't1',
    stepNumber: 10,
    attempt: 1,
    name: 'a',
    status: 'pending',
    input: null,
    output: null,
    toolCalls: null,
    tokensIn: null,
    tokensOut: null,
    error: null,
    startedAt: null,
    completedAt: null,
  });
  const plannerQueExplode: Planner = {
    plan: async () => {
      throw new Error('não deveria replanejar');
    },
  };
  const runner = montar(
    m,
    plannerQueExplode,
    validadorQue(concluiu),
    executorQue(() => OK),
  );

  await runner.runOnce('w1', 7);
  expect(m.task.status).toBe('completed');
  expect(m.steps).toHaveLength(1); // retomou o step existente, não criou outro
});

test('erro do executor vira falha da task, não derruba o worker', async () => {
  const m = criarMundo();
  const runner = montar(
    m,
    planoDe('a'),
    validadorQue(concluiu),
    executorQue(() => {
      throw new Error('motor caiu');
    }),
  );

  await runner.runOnce('w1', 7);
  expect(m.task.status).toBe('failed');
  expect(m.task.error).toContain('motor caiu');
});

test('fila vazia devolve false', async () => {
  const m = criarMundo();
  const { tasks, steps, queue } = fakeRepos(m);
  const runner = new TaskRunner({
    planner: planoDe('a'),
    validator: validadorQue(concluiu),
    executor: executorQue(() => OK),
    tasks,
    steps,
    queue: { ...queue, claim: async () => null },
  });
  expect(await runner.runOnce('w1', 7)).toBe(false);
});
