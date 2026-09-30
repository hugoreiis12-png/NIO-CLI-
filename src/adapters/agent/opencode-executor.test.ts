/**
 * Executor com o motor inteiro falsificado. O foco não é o caminho feliz — é
 * garantir que **nenhuma saída deixa o motor pendurado** e que nada executa sem
 * decisão explícita. Headless, um turno preso não aparece pra ninguém.
 */
import { test, expect } from 'bun:test';
import type { Event, OpencodeClient } from '@opencode-ai/sdk';
import { createOpencodeStepExecutor, buildStepPrompt } from './opencode-executor.js';
import type { PermissionDecider } from '../../core/agent.js';
import type { Task, TaskStep } from '../../core/tasks.js';

const evt = (type: string, properties: Record<string, unknown> = {}): Event =>
  ({ type, properties }) as unknown as Event;

function fakeTask(engineSessionId: string | null = 's1'): Task {
  return {
    id: 'abc12345',
    sessionId: null,
    userId: 1,
    profile: 'qa',
    goal: 'contar arquivos',
    status: 'running',
    currentStep: 10,
    maxSteps: 25,
    workingSet: {},
    engineSessionId,
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

function fakeStep(): TaskStep {
  return {
    id: 1,
    taskId: 'abc12345',
    stepNumber: 10,
    attempt: 1,
    name: 'listar arquivos',
    status: 'running',
    input: { instruction: 'liste os .ts' },
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

interface Registro {
  prompts: string[];
  aborts: number;
  permissoes: Array<{ id: string; response: string }>;
  sessoesCriadas: string[];
}

/** Client falso: registra o que o executor mandou pro motor. */
function fakeClient(reg: Registro): OpencodeClient {
  const client = {
    session: {
      create: async () => {
        const id = `s-nova-${reg.sessoesCriadas.length + 1}`;
        reg.sessoesCriadas.push(id);
        return { data: { id } };
      },
      prompt: async (a: { body: { parts: Array<{ text?: string }> } }) => {
        reg.prompts.push(a.body.parts[0]?.text ?? '');
        return {};
      },
      abort: async () => {
        reg.aborts++;
        return {};
      },
    },
    postSessionIdPermissionsPermissionId: async (a: {
      path: { permissionID: string };
      body: { response: string };
    }) => {
      reg.permissoes.push({ id: a.path.permissionID, response: a.body.response });
      return {};
    },
  };
  return client as unknown as OpencodeClient;
}

/** Stream falso: `null` (conectou) e depois os eventos dados. */
function fakeSubscribe(eventos: Array<Event | null>) {
  return async function* (): AsyncGenerator<Event | null> {
    yield null;
    for (const e of eventos) yield e;
  };
}

const permitir: PermissionDecider = { decide: () => 'allow' };
const negar: PermissionDecider = { decide: () => 'deny' };

function montar(eventos: Array<Event | null>, decider?: PermissionDecider, timeoutMs = 5000) {
  const reg: Registro = { prompts: [], aborts: 0, permissoes: [], sessoesCriadas: [] };
  const exec = createOpencodeStepExecutor({
    client: fakeClient(reg),
    baseUrl: 'http://127.0.0.1:1/',
    model: { providerID: 'nio-local', modelID: 'qwen' },
    subscribe: fakeSubscribe(eventos),
    timeoutMs,
    ...(decider ? { deciderFor: () => decider } : {}),
  });
  return { exec, reg };
}

const parteTexto = (id: string, text: string): Event =>
  evt('message.part.updated', { part: { id, sessionID: 's1', type: 'text', text } });

test('caminho feliz: texto, tools e tokens chegam no outcome', async () => {
  const { exec, reg } = montar(
    [
      parteTexto('t1', 'achei 42 arquivos'),
      evt('message.part.updated', {
        part: {
          id: 'a',
          sessionID: 's1',
          type: 'tool',
          tool: 'grep',
          state: { status: 'completed' },
        },
      }),
      evt('message.part.updated', {
        part: { id: 's', sessionID: 's1', type: 'step-finish', tokens: { input: 90, output: 12 } },
      }),
      evt('session.idle', { sessionID: 's1' }),
    ],
    permitir,
  );

  const out = await exec.run(fakeTask(), fakeStep());
  expect(out.output).toEqual({ text: 'achei 42 arquivos' });
  expect(out.toolCalls).toEqual([{ tool: 'grep', status: 'completed' }]);
  expect(out).toMatchObject({ tokensIn: 90, tokensOut: 12, engineSessionId: 's1' });
  expect(out.halt).toBeUndefined();
  expect(reg.prompts).toHaveLength(1);
});

test('SEGURANÇA: sem decider injetado, nada executa — a task estaciona', async () => {
  const { exec, reg } = montar([
    evt('permission.asked', { id: 'p1', sessionID: 's1', tool: { name: 'bash' } }),
    evt('session.idle', { sessionID: 's1' }),
  ]); // sem decider → default `park`

  const out = await exec.run(fakeTask(), fakeStep());
  expect(out.halt).toMatchObject({ kind: 'approval', subject: 'bash' });
  // O cofre nasce fechado: nenhuma permissão concedida por omissão.
  expect(reg.permissoes).toEqual([]);
  // E o motor não fica trabalhando numa sessão que ninguém lê.
  expect(reg.aborts).toBeGreaterThanOrEqual(1);
});

test('decider `allow` responde `once`, nunca `always`', async () => {
  const { exec, reg } = montar(
    [
      evt('permission.asked', { id: 'p1', sessionID: 's1', tool: { name: 'read' } }),
      parteTexto('t1', 'ok'),
      evt('session.idle', { sessionID: 's1' }),
    ],
    permitir,
  );

  const out = await exec.run(fakeTask(), fakeStep());
  expect(out.halt).toBeUndefined();
  // `always` é decisão do humano, não do worker — conceder permanente aqui
  // vazaria para todos os steps seguintes da sessão.
  expect(reg.permissoes).toEqual([{ id: 'p1', response: 'once' }]);
});

test('decider `deny` rejeita e o turno SEGUE (não estaciona)', async () => {
  const { exec, reg } = montar(
    [
      evt('permission.asked', { id: 'p1', sessionID: 's1', tool: { name: 'bash' } }),
      parteTexto('t1', 'segui sem bash'),
      evt('session.idle', { sessionID: 's1' }),
    ],
    negar,
  );

  const out = await exec.run(fakeTask(), fakeStep());
  expect(reg.permissoes).toEqual([{ id: 'p1', response: 'reject' }]);
  expect(out.halt).toBeUndefined();
  expect(out.output).toEqual({ text: 'segui sem bash' });
});

test('pergunta do motor estaciona o step em vez de pendurar o turno', async () => {
  const { exec, reg } = montar(
    [
      evt('question.asked', { id: 'q1', sessionID: 's1', title: 'qual banco?' }),
      evt('session.idle', { sessionID: 's1' }),
    ],
    permitir,
  );

  const out = await exec.run(fakeTask(), fakeStep());
  expect(out.halt).toMatchObject({ kind: 'question', subject: 'qual banco?' });
  expect(reg.aborts).toBeGreaterThanOrEqual(1);
});

test('família paralela `question.v2.*` também estaciona', async () => {
  const { exec } = montar(
    [
      evt('question.v2.asked', { id: 'q9', sessionID: 's1' }),
      evt('session.idle', { sessionID: 's1' }),
    ],
    permitir,
  );
  expect((await exec.run(fakeTask(), fakeStep())).halt?.kind).toBe('question');
});

test('evento de OUTRA sessão não contamina o step', async () => {
  const { exec } = montar(
    [
      parteTexto('t1', 'meu texto'),
      evt('message.part.updated', {
        part: { id: 't2', sessionID: 'OUTRA', type: 'text', text: 'texto alheio' },
      }),
      evt('session.idle', { sessionID: 's1' }),
    ],
    permitir,
  );

  const out = await exec.run(fakeTask(), fakeStep());
  expect(out.output).toEqual({ text: 'meu texto' });
});

test('stream que acaba sem idle vira halt, não sucesso silencioso', async () => {
  const { exec } = montar([parteTexto('t1', 'parcial')], permitir);
  const out = await exec.run(fakeTask(), fakeStep());
  // Sem isto, um step interrompido seria gravado como `done` com saída parcial.
  expect(out.halt).toMatchObject({ kind: 'timeout' });
});

test('reconexão não reenvia o prompt (duplicaria o turno)', async () => {
  const { exec, reg } = montar(
    [
      parteTexto('t1', 'a'),
      null, // reconectou no meio
      evt('session.idle', { sessionID: 's1' }),
    ],
    permitir,
  );

  await exec.run(fakeTask(), fakeStep());
  expect(reg.prompts).toHaveLength(1);
});

test('sem engineSessionId, cria sessão e devolve o id pro re-attach', async () => {
  const { exec } = montar([evt('session.idle', { sessionID: 's-nova-1' })], permitir);
  const out = await exec.run(fakeTask(null), fakeStep());
  expect(out.engineSessionId).toBe('s-nova-1');
});

function fakeStepWith(over: Partial<TaskStep>): TaskStep {
  return { ...fakeStep(), ...over };
}

test('estouro de contexto: cria sessão NOVA, reenvia com resumo, conclui normalmente', async () => {
  const { exec, reg } = montar(
    [
      evt('session.error', { error: { name: 'ContextOverflowError' } }), // sem sessionID = vale em qualquer sessão
      // sessionID 's-nova-1' de propósito: depois da recuperação a sessão ativa
      // TROCOU — se este evento viesse com o 's1' antigo (como o `parteTexto`
      // padrão faz), `ehDeOutraSessao` o descartaria e o teste passaria vazio
      // pelo motivo errado.
      evt('message.part.updated', {
        part: { id: 't1', sessionID: 's-nova-1', type: 'text', text: 'achei depois de recuperar' },
      }),
      evt('session.idle', {}),
    ],
    permitir,
  );

  const priorSteps: TaskStep[] = [
    fakeStepWith({
      id: 9,
      stepNumber: 0,
      name: 'passo anterior',
      status: 'done',
      output: { text: 'resultado do passo 1' },
    }),
  ];
  const out = await exec.run(fakeTask(), fakeStep(), priorSteps);

  // Sessão trocou: a de recuperação é uma NOVA (s-nova-1), não a original (s1).
  expect(reg.sessoesCriadas).toEqual(['s-nova-1']);
  expect(out.engineSessionId).toBe('s-nova-1');
  expect(out.halt).toBeUndefined();
  expect(out.output).toEqual({ text: 'achei depois de recuperar' });

  // O resumo de recuperação carrega o objetivo, o step atual E o que já foi feito.
  const digest = reg.prompts[1]; // prompts[0] = tentativa original; prompts[1] = o resumo
  expect(digest).toContain('contar arquivos'); // goal
  expect(digest).toContain('listar arquivos'); // step atual
  expect(digest).toContain('passo anterior'); // trilha já concluída
  expect(digest).toContain('resultado do passo 1');
  expect(digest).toContain('Continue a partir daqui');
});

test('estouro de contexto repetido esgota as tentativas e falha com diagnóstico HONESTO', async () => {
  const { exec, reg } = montar(
    [
      evt('session.error', { error: { name: 'ContextOverflowError' } }),
      evt('session.error', { error: { name: 'ContextOverflowError' } }),
      evt('session.error', { error: { name: 'ContextOverflowError' } }), // além do teto — nunca deveria ser processado
      evt('session.idle', {}),
    ],
    permitir,
  );

  const out = await exec.run(fakeTask(), fakeStep(), []);
  expect(out.halt?.kind).toBe('engine_error');
  // Diagnóstico real, não "timeout" — é a diferença que o § do usuário pedia.
  expect(out.halt?.reason).toContain('estouro de contexto');
  // 2 sessões novas (o teto), não 3 — prova que o cap realmente existe, não é decorativo.
  expect(reg.sessoesCriadas).toHaveLength(2);
});

test('resposta cortada (output_length): MESMA sessão, pede continuação, concatena o texto', async () => {
  const { exec, reg } = montar(
    [
      parteTexto('t1', 'começo da resposta, cortado aqui'),
      evt('session.error', { error: { name: 'MessageOutputLengthError' } }),
      parteTexto('t2', ' — e o resto depois de continuar'),
      evt('session.idle', { sessionID: 's1' }),
    ],
    permitir,
  );

  const out = await exec.run(fakeTask(), fakeStep(), []);
  // NENHUMA sessão nova: o problema é o teto de UMA geração, não o histórico.
  expect(reg.sessoesCriadas).toEqual([]);
  expect(out.engineSessionId).toBe('s1');
  expect(out.halt).toBeUndefined();
  // As duas partes concatenam — é a resposta "continuada", não duas respostas soltas.
  expect(out.output).toEqual({
    text: 'começo da resposta, cortado aqui — e o resto depois de continuar',
  });
  expect(reg.prompts[1]).toContain('Continue EXATAMENTE de onde parou');
});

test('resposta cortada repetidamente esgota as tentativas e falha com diagnóstico HONESTO', async () => {
  const eventos = Array.from({ length: 4 }, () =>
    evt('session.error', { error: { name: 'MessageOutputLengthError' } }),
  );
  const { exec, reg } = montar([...eventos, evt('session.idle', {})], permitir);

  const out = await exec.run(fakeTask(), fakeStep(), []);
  expect(out.halt?.kind).toBe('engine_error');
  expect(out.halt?.reason).toContain('resposta cortada');
  expect(reg.sessoesCriadas).toEqual([]); // continuação nunca cria sessão
});

test('erro genérico do motor (sem recuperação conhecida) falha na hora, sem retry', async () => {
  const { exec, reg } = montar(
    [evt('session.error', { error: { name: 'ProviderAuthError' } }), evt('session.idle', {})],
    permitir,
  );

  const out = await exec.run(fakeTask(), fakeStep(), []);
  expect(out.halt).toMatchObject({ kind: 'engine_error', subject: 'ProviderAuthError' });
  expect(reg.sessoesCriadas).toEqual([]);
  // Só o prompt original — nenhuma tentativa de recuperação pra um erro sem receita.
  expect(reg.prompts).toHaveLength(1);
});

test('prompt carrega o objetivo da task E a instrução do step', () => {
  const p = buildStepPrompt(fakeTask(), fakeStep());
  expect(p).toContain('contar arquivos'); // sem o goal o modelo perde o fio entre steps
  expect(p).toContain('liste os .ts');
  expect(p).toContain('listar arquivos');
});
