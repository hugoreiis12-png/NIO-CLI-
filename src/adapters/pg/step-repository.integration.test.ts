/**
 * Integração do `StepRepository`. O foco é a semântica de retomada: um step que
 * para para esperar um humano tem que voltar a ser encontrável pelo
 * `nextPending`, senão a task nunca retoma depois do `nio task approve`.
 *
 * Gated duplo, como a fila: `NIO_DATABASE_URL` + existência da tabela.
 */
import { test, expect, afterAll, beforeAll } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { createUserRepository } from './user-repository.js';
import { createTaskRepository } from './task-repository.js';
import { createStepRepository } from './step-repository.js';
import { query, closePool } from './client.js';

const hasDb = Boolean(process.env.NIO_DATABASE_URL);
let temTabela = false;

beforeAll(async () => {
  if (!hasDb) return;
  const res = await query<{ existe: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'task_steps') AS existe`,
  );
  temTabela = res.rows[0]?.existe === true;
});

afterAll(async () => {
  if (hasDb) await closePool();
});

const dbTest = hasDb ? test : test.skip;

async function semear(): Promise<{ taskId: string; limpar: () => Promise<void> }> {
  const user = await createUserRepository().create({
    name: `nio-step-${randomUUID()}`,
    password: `pw-${randomUUID()}`,
  });
  const task = await createTaskRepository().create({
    userId: user.id,
    sessionId: null,
    profile: 'qa',
    goal: 'g',
  });
  return {
    taskId: task.id,
    limpar: async () => {
      await query('DELETE FROM user_cli WHERE id = $1', [user.id]);
    },
  };
}

dbTest('reopen devolve o step à fila — a task retoma depois da aprovação', async () => {
  if (!temTabela) return;
  const { taskId, limpar } = await semear();
  const repo = createStepRepository();
  try {
    const [a] = await repo.insertAll(taskId, [{ stepNumber: 10, name: 'a' }]);
    await repo.start(a!.id);
    // Em `running`, o step some da fila — é isso que prendia a task para sempre.
    expect(await repo.nextPending(taskId)).toBeNull();

    await repo.reopen(a!.id);
    const retomado = await repo.nextPending(taskId);
    expect(retomado?.id).toBe(a!.id);
    expect(retomado?.attempt).toBe(1); // reabrir não gasta tentativa
    expect(retomado?.startedAt).toBeNull(); // duração medida não pode virar ficção
  } finally {
    await limpar();
  }
});

dbTest('reopen não ressuscita step concluído nem falhado', async () => {
  if (!temTabela) return;
  const { taskId, limpar } = await semear();
  const repo = createStepRepository();
  try {
    const criados = await repo.insertAll(taskId, [
      { stepNumber: 10, name: 'feito' },
      { stepNumber: 20, name: 'falho' },
    ]);
    await repo.start(criados[0]!.id);
    await repo.finish(criados[0]!.id, { output: { text: 'ok' } });
    await repo.start(criados[1]!.id);
    await repo.failStep(criados[1]!.id, 'erro');

    await repo.reopen(criados[0]!.id);
    await repo.reopen(criados[1]!.id);

    // A guarda `WHERE status = 'running'` é o que impede reexecutar trabalho pronto.
    const todos = await repo.listByTask(taskId);
    expect(todos.map((s) => s.status)).toEqual(['done', 'failed']);
    expect(await repo.nextPending(taskId)).toBeNull();
  } finally {
    await limpar();
  }
});

dbTest('retry acrescenta tentativa em vez de sobrescrever o histórico', async () => {
  if (!temTabela) return;
  const { taskId, limpar } = await semear();
  const repo = createStepRepository();
  try {
    const [a] = await repo.insertAll(taskId, [{ stepNumber: 10, name: 'a' }]);
    await repo.start(a!.id);
    await repo.failStep(a!.id, "Cannot find table 'X'");
    const nova = await repo.retry(a!.id);

    expect(nova.attempt).toBe(2);
    const todos = await repo.listByTask(taskId);
    expect(todos).toHaveLength(2);
    // A tentativa que falhou continua legível — é dela que sai a lição.
    expect(todos[0]!.error).toContain('Cannot find table');
  } finally {
    await limpar();
  }
});
