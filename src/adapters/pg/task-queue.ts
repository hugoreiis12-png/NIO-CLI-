/**
 * Fila de tasks no próprio Postgres (`FOR UPDATE SKIP LOCKED`), sem broker —
 * ADR 0014 fixou uma instância e esta escala não justifica Redis/RabbitMQ.
 *
 * Três mecanismos que sustentam a durabilidade:
 * - **SKIP LOCKED**: N workers coexistem sem dois pegarem a mesma task.
 * - **Lease + fence**: o `claim` incrementa `fence`; toda escrita do worker exige
 *   `AND fence = $n`. Um worker que congelou e ressuscitou grava com fence velho
 *   e não afeta linha nenhuma — sem isso, dois workers escrevem no mesmo step.
 * - **LISTEN/NOTIFY**: acorda na hora. O poll é rede de segurança, nunca a via
 *   principal.
 */
import type { PoolClient } from 'pg';
import type { Task, TaskQueue } from '../../core/tasks.js';
import { getPool, query } from './client.js';
import { TASK_COLS, mapTaskRow, type TaskRow } from './task-repository.js';

/** Canal do NOTIFY. Constante — nunca interpolar identificador vindo de fora. */
const CHANNEL = 'nio_task_new';

/** Client dedicado do LISTEN: o pool devolveria a conexão e a inscrição morreria. */
let listener: PoolClient | null = null;
const waiters = new Set<() => void>();

function acordarTodos(): void {
  for (const w of [...waiters]) w();
}

/** Assina o canal uma vez por processo; reassina se a conexão cair. */
async function ensureListener(): Promise<void> {
  if (listener) return;
  const client = await getPool().connect();
  client.on('notification', acordarTodos);
  client.on('error', () => {
    listener = null;
    client.removeAllListeners();
    client.release(true); // destrói: conexão suja não volta pro pool
    acordarTodos(); // quem esperava cai no poll em vez de pendurar
  });
  await client.query(`LISTEN ${CHANNEL}`);
  listener = client;
}

/** Solta o LISTEN — usado no shutdown do worker. */
export function closeTaskQueueListener(): void {
  if (!listener) return;
  const client = listener;
  listener = null;
  client.removeAllListeners();
  client.release(true);
}

export function createTaskQueue(): TaskQueue {
  return {
    async claim(workerId: string, userId: number): Promise<Task | null> {
      // `status` no claim preserva o checkpoint-and-resume: task que já tem plano
      // volta pra `running` e retoma no step pendente, não replaneja do zero.
      const res = await query<TaskRow>(
        `UPDATE tasks
            SET status = CASE WHEN current_step IS NULL THEN 'planning' ELSE 'running' END,
                locked_by = $1, locked_at = now(), fence = fence + 1
          WHERE id = (
            SELECT id FROM tasks
             WHERE status = 'pending' AND user_id = $2 AND kind = 'agent'
             ORDER BY created_at
             FOR UPDATE SKIP LOCKED
             LIMIT 1
          )
      RETURNING ${TASK_COLS}`,
        [workerId, userId],
      );
      const row = res.rows[0];
      return row ? mapTaskRow(row) : null;
    },

    async heartbeat(taskId: string, workerId: string, fence: number): Promise<boolean> {
      const res = await query(
        `UPDATE tasks SET locked_at = now()
          WHERE id = $1 AND locked_by = $2 AND fence = $3`,
        [taskId, workerId, fence],
      );
      return (res.rowCount ?? 0) > 0;
    },

    async release(taskId: string, workerId: string, fence: number): Promise<void> {
      // Só solta o lease — o status já foi definido por quem terminou o ciclo.
      await query(
        `UPDATE tasks SET locked_by = NULL, locked_at = NULL
          WHERE id = $1 AND locked_by = $2 AND fence = $3`,
        [taskId, workerId, fence],
      );
    },

    async reclaimExpired(olderThanMs: number): Promise<number> {
      // Sem isto, um worker morto trava a task em `running` para sempre.
      //
      // O `UPDATE` em `task_steps` não é higiene: o worker morreu NO MEIO de um
      // step, que ficou `running`. Devolver só a task deixa esse step órfão, e
      // como o `nextPending` só enxerga `pending`, o worker seguinte PULARIA o
      // passo interrompido e seguiria para o próximo — perdendo trabalho em
      // silêncio. Medido num crash real, não deduzido.
      //
      // Uma statement só: reclamar a task e reabrir o step têm de ser atômicos,
      // senão outro worker reivindica no intervalo e vê o estado quebrado.
      const res = await query<{ total: string }>(
        `WITH reclamadas AS (
           UPDATE tasks
              SET status = 'pending', locked_by = NULL, locked_at = NULL
            WHERE status IN ('planning', 'running', 'validating')
              AND locked_at IS NOT NULL
              AND locked_at < now() - ($1::bigint * interval '1 millisecond')
          RETURNING id
         ), reabertos AS (
           UPDATE task_steps
              SET status = 'pending', started_at = NULL
            WHERE task_id IN (SELECT id FROM reclamadas)
              AND status = 'running'
          RETURNING 1
         )
         SELECT count(*)::text AS total FROM reclamadas`,
        [Math.max(1000, olderThanMs)],
      );
      return Number(res.rows[0]?.total ?? 0);
    },

    async notifyNew(): Promise<void> {
      // Best-effort: perder o NOTIFY só custa a latência do poll.
      try {
        await query('SELECT pg_notify($1, $2)', [CHANNEL, '']);
      } catch {
        /* o poll cobre */
      }
    },

    async waitForNew(signal: AbortSignal, timeoutMs: number): Promise<void> {
      if (signal.aborted) return;
      try {
        await ensureListener();
      } catch {
        // Sem LISTEN o worker ainda funciona, só mais lento.
      }
      await esperarSinal(signal, timeoutMs);
    },
  };
}

/** Resolve no primeiro que acontecer: NOTIFY, timeout ou abort. */
function esperarSinal(signal: AbortSignal, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      waiters.delete(finish);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    waiters.add(finish);
    signal.addEventListener('abort', finish, { once: true });
  });
}
