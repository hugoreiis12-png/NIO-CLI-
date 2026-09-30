/**
 * Integração da fila de tasks contra o Postgres real. É a garantia do mecanismo
 * que sustenta a execução durável: dois workers não pegam a mesma task, worker
 * zumbi não grava, e lease vencida volta pra fila.
 *
 * Gated duplo: em `NIO_DATABASE_URL` (sem banco → pula) **e** na existência da
 * tabela `tasks` — enquanto a migration 0012 não rodou no banco apontado, o
 * teste pula em vez de pintar a suíte de vermelho por motivo errado.
 */
import { test, expect, afterAll, beforeAll } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { createUserRepository } from './user-repository.js';
import { createTaskRepository } from './task-repository.js';
import { createStepRepository } from './step-repository.js';
import { createTaskQueue, closeTaskQueueListener } from './task-queue.js';
import { query, closePool } from './client.js';

const hasDb = Boolean(process.env.NIO_DATABASE_URL);
let temTabela = false;

beforeAll(async () => {
  if (!hasDb) return;
  const res = await query<{ existe: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'tasks'
     ) AS existe`,
  );
  temTabela = res.rows[0]?.existe === true;
  if (!temTabela) {
    console.warn('[tasks] migration 0012 não aplicada neste banco — testes de fila pulados.');
  }
});

afterAll(async () => {
  if (!hasDb) return;
  closeTaskQueueListener();
  await closePool();
});

const dbTest = hasDb ? test : test.skip;

/** Usuário descartável + N tasks pendentes. Devolve o cleanup. */
async function semear(qtd: number): Promise<{ userId: number; limpar: () => Promise<void> }> {
  const users = createUserRepository();
  const tasks = createTaskRepository();
  const user = await users.create({
    name: `nio-task-${randomUUID()}`,
    password: `pw-${randomUUID()}`,
  });
  for (let i = 0; i < qtd; i++) {
    await tasks.create({
      userId: user.id,
      sessionId: null,
      profile: 'qa',
      goal: `objetivo ${i}`,
    });
  }
  return {
    userId: user.id,
    limpar: async () => {
      await query('DELETE FROM user_cli WHERE id = $1', [user.id]); // CASCADE leva as tasks
    },
  };
}

dbTest('claim concorrente: só um worker leva a task', async () => {
  if (!temTabela) return;
  const { userId, limpar } = await semear(1);
  const fila = createTaskQueue();
  try {
    const [a, b] = await Promise.all([
      fila.claim('worker-a', userId),
      fila.claim('worker-b', userId),
    ]);
    const vencedores = [a, b].filter((t) => t !== null);
    expect(vencedores).toHaveLength(1);
    // Quem venceu virou `planning` (task sem plano) e o fence subiu de 0 para 1.
    expect(vencedores[0]!.status).toBe('planning');
    expect(vencedores[0]!.fence).toBe(1);
    expect(vencedores[0]!.lockedBy).toMatch(/^worker-[ab]$/);
  } finally {
    await limpar();
  }
});

dbTest('claim não cruza usuário: worker só pega a task do seu dono', async () => {
  if (!temTabela) return;
  const dono = await semear(1);
  const outro = await semear(0);
  const fila = createTaskQueue();
  try {
    expect(await fila.claim('worker-intruso', outro.userId)).toBeNull();
    expect(await fila.claim('worker-dono', dono.userId)).not.toBeNull();
  } finally {
    await dono.limpar();
    await outro.limpar();
  }
});

dbTest('fence velho não grava: worker zumbi é barrado', async () => {
  if (!temTabela) return;
  const { userId, limpar } = await semear(1);
  const fila = createTaskQueue();
  const tasks = createTaskRepository();
  try {
    const primeira = (await fila.claim('worker-a', userId))!;
    const fenceVelho = primeira.fence;

    // Simula o worker travado: a lease vence e outro worker reivindica.
    await query(`UPDATE tasks SET locked_at = now() - interval '1 hour' WHERE id = $1`, [
      primeira.id,
    ]);
    expect(await fila.reclaimExpired(60_000)).toBeGreaterThanOrEqual(1);
    const segunda = (await fila.claim('worker-b', userId))!;
    expect(segunda.fence).toBe(fenceVelho + 1);

    // O zumbi acorda e tenta escrever com o fence antigo — não pode afetar nada.
    expect(await tasks.setStatus(primeira.id, 'completed', fenceVelho)).toBe(false);
    expect(await fila.heartbeat(primeira.id, 'worker-a', fenceVelho)).toBe(false);
    expect((await tasks.findById(primeira.id))!.status).toBe('planning');

    // O dono atual do lease escreve normalmente.
    expect(await tasks.setStatus(segunda.id, 'running', segunda.fence, { currentStep: 10 })).toBe(
      true,
    );
  } finally {
    await limpar();
  }
});

dbTest('o worker NUNCA reivindica turno de chat', async () => {
  if (!temTabela) return;
  const users = createUserRepository();
  const tasks = createTaskRepository();
  const user = await users.create({
    name: `nio-kind-${randomUUID()}`,
    password: `pw-${randomUUID()}`,
  });
  const fila = createTaskQueue();
  try {
    const chat = await tasks.create({
      userId: user.id,
      sessionId: null,
      profile: 'qa',
      goal: 'oi',
      kind: 'chat',
    });
    expect(chat.kind).toBe('chat');

    // Sem o recorte por kind, o worker pegaria o turno do usuário e o
    // RE-EXECUTARIA com o Planner — a mensagem viraria um plano rodando sozinha.
    expect(await fila.claim('worker-a', user.id)).toBeNull();

    const agente = await tasks.create({
      userId: user.id,
      sessionId: null,
      profile: 'qa',
      goal: 'trabalho',
    });
    expect(agente.kind).toBe('agent'); // default sem passar nada
    const pega = await fila.claim('worker-a', user.id);
    expect(pega?.id).toBe(agente.id);
  } finally {
    await query('DELETE FROM user_cli WHERE id = $1', [user.id]);
  }
});

dbTest('crash no meio de um step: o step interrompido volta pra fila junto', async () => {
  if (!temTabela) return;
  const { userId, limpar } = await semear(1);
  const fila = createTaskQueue();
  const steps = createStepRepository();
  try {
    const t = (await fila.claim('worker-morto', userId))!;
    const [a, b] = await steps.insertAll(t.id, [
      { stepNumber: 10, name: 'a' },
      { stepNumber: 20, name: 'b' },
    ]);
    await steps.start(a!.id); // worker morre AQUI, com o step em `running`
    await query(`UPDATE tasks SET locked_at = now() - interval '1 hour' WHERE id = $1`, [t.id]);

    expect(await fila.reclaimExpired(60_000)).toBe(1);

    // Sem reabrir o step, o `nextPending` devolveria o step 20 e o 10 seria
    // pulado em silêncio — trabalho perdido sem nenhum sinal.
    const proximo = await steps.nextPending(t.id);
    expect(proximo?.id).toBe(a!.id);
    expect(proximo?.stepNumber).toBe(10);
    expect(proximo?.startedAt).toBeNull();
    // O step que nem começou não é tocado.
    const todos = await steps.listByTask(t.id);
    expect(todos.find((s) => s.id === b!.id)?.status).toBe('pending');
  } finally {
    await limpar();
  }
});

dbTest('reclaim não mexe em step já concluído', async () => {
  if (!temTabela) return;
  const { userId, limpar } = await semear(1);
  const fila = createTaskQueue();
  const steps = createStepRepository();
  try {
    const t = (await fila.claim('worker-morto', userId))!;
    const [a] = await steps.insertAll(t.id, [{ stepNumber: 10, name: 'a' }]);
    await steps.start(a!.id);
    await steps.finish(a!.id, { output: { text: 'pronto' } });
    await query(`UPDATE tasks SET locked_at = now() - interval '1 hour' WHERE id = $1`, [t.id]);

    await fila.reclaimExpired(60_000);
    // Refazer trabalho concluído custaria tokens e poderia repetir efeito colateral.
    expect((await steps.listByTask(t.id))[0]!.status).toBe('done');
  } finally {
    await limpar();
  }
});

dbTest('resume: task já planejada volta pra running, não replaneja', async () => {
  if (!temTabela) return;
  const { userId, limpar } = await semear(1);
  const fila = createTaskQueue();
  const tasks = createTaskRepository();
  try {
    const t = (await fila.claim('worker-a', userId))!;
    await tasks.setStatus(t.id, 'running', t.fence, { currentStep: 20 });
    await query(`UPDATE tasks SET locked_at = now() - interval '1 hour' WHERE id = $1`, [t.id]);
    await fila.reclaimExpired(60_000);

    // `current_step` preenchido = já tem plano; o claim não pode voltar pra `planning`.
    const retomada = (await fila.claim('worker-b', userId))!;
    expect(retomada.status).toBe('running');
    expect(retomada.currentStep).toBe(20);
  } finally {
    await limpar();
  }
});
