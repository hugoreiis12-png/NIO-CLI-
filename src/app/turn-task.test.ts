/**
 * Registro do turno da TUI. A propriedade que mais importa não é gravar certo —
 * é **nunca derrubar o chat**. Um banco fora do ar tem que passar despercebido
 * pelo usuário que só quer conversar.
 */
import { test, expect } from 'bun:test';
import { beginTurn, endTurn, abortTurn, delegateTurn, resumir } from './turn-task.js';
import type { StepRepository, TaskQueue, TaskRepository, TaskStep } from '../core/tasks.js';

function repos(): {
  tasks: TaskRepository;
  steps: StepRepository;
  registro: { criadas: unknown[]; finalizados: unknown[]; completadas: unknown[] };
} {
  const registro = {
    criadas: [] as unknown[],
    finalizados: [] as unknown[],
    completadas: [] as unknown[],
  };
  const tasks = {
    create: async (input: unknown) => {
      registro.criadas.push(input);
      return { id: 'task-1', kind: 'chat' } as never;
    },
    complete: async (id: string, fence: number, result: string) => {
      registro.completadas.push({ id, fence, result });
      return true;
    },
    fail: async () => true,
  } as unknown as TaskRepository;
  const steps = {
    insertAll: async (_t: string, novos: readonly { stepNumber: number; name: string }[]) =>
      novos.map((s) => ({ id: 42, stepNumber: s.stepNumber, name: s.name }) as TaskStep),
    start: async () => {},
    finish: async (id: number, r: unknown) => {
      registro.finalizados.push({ id, r });
    },
    failStep: async () => {},
  } as unknown as StepRepository;
  return { tasks, steps, registro };
}

/** Repositório que explode em tudo — simula Postgres fora do ar. */
const quebrado = {
  tasks: {
    create: async () => {
      throw new Error('banco fora');
    },
  } as unknown as TaskRepository,
  steps: {
    finish: async () => {
      throw new Error('banco fora');
    },
    failStep: async () => {
      throw new Error('banco fora');
    },
  } as unknown as StepRepository,
};

test('abre o turno como task chat, com um step só', async () => {
  const { tasks, steps, registro } = repos();
  const ref = await beginTurn(
    { userId: 7, sessionId: 's1', profile: 'qa', text: 'liste os arquivos' },
    { tasks, steps },
  );

  expect(ref).toEqual({ taskId: 'task-1', stepId: 42 });
  // `running` desde o nascimento: a fila só enxerga `pending`, então o worker não
  // reivindica (nem replaneja por cima do step) um turno que a TUI está executando.
  expect(registro.criadas[0]).toMatchObject({
    kind: 'chat',
    status: 'running',
    goal: 'liste os arquivos',
    userId: 7,
  });
});

test('NÃO planeja: a mensagem do usuário já é a instrução', async () => {
  const { tasks, steps } = repos();
  const ref = await beginTurn(
    { userId: 7, sessionId: null, profile: 'qa', text: 'oi' },
    { tasks, steps },
  );
  // Um "oi" não pode virar um plano de 5 passos — por isso o turno de chat
  // nasce com o step único já pronto, sem passar pelo Planner.
  expect(ref).not.toBeNull();
});

test('BANCO FORA: begin devolve null e não lança', async () => {
  const ref = await beginTurn({ userId: 7, sessionId: null, profile: 'qa', text: 'oi' }, quebrado);
  expect(ref).toBeNull();
});

test('BANCO FORA: end e abort engolem a falha', async () => {
  // Se estes lançassem, o erro subiria no meio do render da TUI.
  await endTurn({ taskId: 't', stepId: 1 }, { text: 'resposta' }, quebrado);
  await abortTurn({ taskId: 't', stepId: 1 }, 'interrompido', quebrado);
  expect(true).toBe(true);
});

test('ref nulo é no-op — o caller não precisa checar', async () => {
  const { tasks, steps, registro } = repos();
  await endTurn(null, { text: 'x' }, { tasks, steps });
  await abortTurn(null, 'x', { tasks, steps });
  expect(registro.finalizados).toEqual([]);
});

test('mensagem vazia não vira task', async () => {
  const { tasks, steps, registro } = repos();
  expect(
    await beginTurn({ userId: 7, sessionId: null, profile: 'qa', text: '   ' }, { tasks, steps }),
  ).toBeNull();
  expect(registro.criadas).toEqual([]);
});

test('end grava saída e tokens e conclui a task', async () => {
  const { tasks, steps, registro } = repos();
  await endTurn(
    { taskId: 'task-1', stepId: 42 },
    {
      text: 'achei 12',
      toolCalls: [{ tool: 'grep', status: 'completed' }],
      tokensIn: 90,
      tokensOut: 8,
    },
    { tasks, steps },
  );
  expect(registro.finalizados[0]).toMatchObject({ id: 42 });
  // fence 0: turno de chat não tem lease, quem executa é a TUI.
  expect(registro.completadas[0]).toMatchObject({ id: 'task-1', fence: 0 });
});

test('resumir colapsa espaço e trunca sem cortar no meio da palavra final', () => {
  expect(resumir('  liste   os\n arquivos  ')).toBe('liste os arquivos');
  const longo = resumir('x'.repeat(200));
  expect(longo).toHaveLength(120);
  expect(longo.endsWith('…')).toBe(true);
});

function delegacao(opts: { setStatusOk?: boolean; findById?: unknown } = {}) {
  const chamadas: string[] = [];
  const tasks = {
    findById: async () =>
      opts.findById === undefined ? { id: 'task-1', fence: 0 } : opts.findById,
    setStatus: async (id: string, status: string, fence: number, patch: unknown) => {
      chamadas.push(`setStatus:${status}:${fence}:${JSON.stringify(patch)}`);
      return opts.setStatusOk ?? true;
    },
  } as unknown as TaskRepository;
  const steps = {
    reopen: async (id: number) => {
      chamadas.push(`reopen:${id}`);
    },
  } as unknown as StepRepository;
  const queue = {
    notifyNew: async () => {
      chamadas.push('notify');
    },
  } as unknown as TaskQueue;
  return { deps: { tasks, steps, queue }, chamadas };
}

const REF = { taskId: 'task-1', stepId: 42 };

test('delega: reabre o step ANTES de devolver a task à fila, e acorda o worker', async () => {
  const { deps, chamadas } = delegacao();
  expect(await delegateTurn(REF, 'eng-1', deps)).toBe(true);
  // Ordem é o contrato: task `pending` sem step pendente = worker valida trilha vazia.
  expect(chamadas).toEqual([
    'reopen:42',
    'setStatus:pending:0:{"currentStep":10,"engineSessionId":"eng-1"}',
    'notify',
  ]);
});

test('delega: perdeu a corrida do fence → false e não acorda ninguém', async () => {
  const { deps, chamadas } = delegacao({ setStatusOk: false });
  expect(await delegateTurn(REF, 'eng-1', deps)).toBe(false);
  expect(chamadas).not.toContain('notify');
});

test('delega: task inexistente ou banco fora → false, sem lançar', async () => {
  expect(await delegateTurn(REF, 'eng-1', delegacao({ findById: null }).deps)).toBe(false);
  expect(await delegateTurn(REF, 'eng-1', quebrado)).toBe(false);
});
