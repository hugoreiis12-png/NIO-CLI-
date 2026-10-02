/**
 * O laço do `nio-worker`: reivindica uma task, planeja, executa os steps e
 * valida — persistindo a cada transição.
 *
 * A regra que sustenta a durabilidade: **nenhum estado crítico vive só na RAM**.
 * Cada marca `CHECKPOINT` abaixo é um UPDATE antes de seguir. Depois de um
 * crash, o worker retoma no primeiro step `pending` em vez de refazer do zero —
 * é checkpoint-and-resume, não replay determinístico.
 *
 * Perder o lease encerra o processamento na hora: o `fence` subiu, outro worker
 * assumiu, e continuar escrevendo seria corromper a trilha dele.
 */
import type { Planner, StepExecutor, Validator } from '../core/agent.js';
import type { StepRepository, Task, TaskQueue, TaskRepository } from '../core/tasks.js';
import { createTaskRepository } from '../adapters/pg/task-repository.js';
import { createStepRepository } from '../adapters/pg/step-repository.js';
import { createTaskQueue } from '../adapters/pg/task-queue.js';
import { numberSteps } from './task-manager.js';
import { haltParaTransicao, incompletoSemSaida, mensagemDeErro } from './task-outcome.js';

const HEARTBEAT_MS = 30_000;
const LEASE_MS = 5 * 60_000;
const POLL_MS = 5_000;
/** Teto de voltas validar→executar por task. Rede contra o Validator teimoso. */
const MAX_CICLOS = 20;

export interface TaskRunnerDeps {
  planner: Planner;
  validator: Validator;
  executor: StepExecutor;
  tasks?: TaskRepository;
  steps?: StepRepository;
  queue?: TaskQueue;
  heartbeatMs?: number;
  leaseMs?: number;
  pollMs?: number;
  /** Chamado a cada transição — o entrypoint loga; os testes observam. */
  onEvent?: (evento: string, detalhe: Record<string, unknown>) => void;
}

/** Sinaliza que o lease foi perdido — encerra o processamento sem marcar falha. */
class LeasePerdidoError extends Error {
  constructor() {
    super('lease perdido');
    this.name = 'LeasePerdidoError';
  }
}

export class TaskRunner {
  private readonly tasks: TaskRepository;
  private readonly steps: StepRepository;
  private readonly queue: TaskQueue;
  private readonly log: (e: string, d: Record<string, unknown>) => void;

  constructor(private readonly deps: TaskRunnerDeps) {
    this.tasks = deps.tasks ?? createTaskRepository();
    this.steps = deps.steps ?? createStepRepository();
    this.queue = deps.queue ?? createTaskQueue();
    this.log = deps.onEvent ?? (() => {});
  }

  /** Uma volta: reivindica e processa. `false` = fila vazia. */
  async runOnce(workerId: string, userId: number): Promise<boolean> {
    const reclamadas = await this.queue.reclaimExpired(this.deps.leaseMs ?? LEASE_MS);
    if (reclamadas > 0) this.log('lease_reclaimed', { count: reclamadas });

    const task = await this.queue.claim(workerId, userId);
    if (!task) return false;

    this.log('task_claimed', { taskId: task.id, status: task.status, fence: task.fence });
    const parar = this.startHeartbeat(task, workerId);
    try {
      await this.processar(task, workerId);
    } catch (err) {
      if (err instanceof LeasePerdidoError) {
        this.log('lease_lost', { taskId: task.id });
      } else {
        this.log('task_failed', { taskId: task.id, error: mensagemDeErro(err) });
        // Banco fora aqui não pode pular o `release`: o lease vence e o reclaim cobre.
        await this.tasks.fail(task.id, task.fence, mensagemDeErro(err)).catch((failErr) => {
          this.log('task_fail_unrecorded', { taskId: task.id, error: mensagemDeErro(failErr) });
        });
      }
    } finally {
      parar();
      await this.queue.release(task.id, workerId, task.fence);
    }
    return true;
  }

  /** Laço até o `signal` abortar. Dorme no `NOTIFY` quando a fila está vazia. */
  async loop(workerId: string, userId: number, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      let trabalhou = false;
      try {
        trabalhou = await this.runOnce(workerId, userId);
      } catch (err) {
        // Falha de infraestrutura (banco fora) não pode matar o worker.
        this.log('loop_error', { error: mensagemDeErro(err) });
      }
      if (!trabalhou && !signal.aborted) {
        await this.queue.waitForNew(signal, this.deps.pollMs ?? POLL_MS);
      }
    }
  }

  /**
   * Renova o lease durante um step longo. Só renova — quem detecta a perda é o
   * `conferirLease`, que é síncrono com o laço.
   */
  private startHeartbeat(task: Task, workerId: string): () => void {
    const timer = setInterval(() => {
      void this.queue.heartbeat(task.id, workerId, task.fence).catch(() => {});
    }, this.deps.heartbeatMs ?? HEARTBEAT_MS);
    return () => clearInterval(timer);
  }

  /**
   * Confere o lease **antes** de cada transição, com um heartbeat explícito.
   *
   * Custa uma query por step — irrelevante perto do custo de um step — e compra
   * determinismo: a alternativa (ler um flag atualizado pelo `setInterval`) faz
   * a detecção depender de o timer ter disparado, o que é corrida pura.
   */
  private async conferirLease(task: Task, workerId: string): Promise<void> {
    const ok = await this.queue.heartbeat(task.id, workerId, task.fence);
    if (!ok) throw new LeasePerdidoError();
  }

  /** Ciclo completo da task: planeja (se preciso), executa, valida, repete. */
  private async processar(task: Task, workerId: string): Promise<void> {
    // Chat delegadas (Opção A): já têm steps prontos na criação, não replanejam
    const isChatDelegada = task.kind === 'chat' && task.currentStep !== null;
    if (task.status === 'planning' && !isChatDelegada) await this.planejar(task);

    for (let ciclo = 0; ciclo < MAX_CICLOS; ciclo++) {
      const parou = await this.executarSteps(task, workerId);
      if (parou) return;
      if (await this.validar(task, workerId)) return;
    }
    await this.tasks.fail(task.id, task.fence, 'Excedeu o número de ciclos de validação.');
  }

  /** CHECKPOINT: o plano inteiro entra numa transação antes de qualquer execução. */
  private async planejar(task: Task): Promise<void> {
    const plano = await this.deps.planner.plan(task);
    const criados = await this.steps.insertAll(
      task.id,
      numberSteps(plano.map((p) => ({ name: p.name, input: { instruction: p.instruction } }))),
    );
    this.log('task_planned', { taskId: task.id, steps: criados.length });
    await this.tasks.setStatus(task.id, 'running', task.fence, {
      currentStep: criados[0]?.stepNumber ?? null,
    });
  }

  /** Executa os steps pendentes. `true` = a task parou (halt) e não deve validar. */
  private async executarSteps(task: Task, workerId: string): Promise<boolean> {
    for (;;) {
      await this.conferirLease(task, workerId);
      const step = await this.steps.nextPending(task.id);
      if (!step) return false;

      await this.steps.start(step.id); // CHECKPOINT
      // Trilha já concluída (exclui o step atual, que acabou de virar `running`):
      // o executor usa isto pra montar contexto de continuidade se precisar
      // recriar a sessão do motor no meio do step (estouro de contexto).
      const trilha = await this.steps.listByTask(task.id);
      const priorSteps = trilha.filter((s) => s.id !== step.id);
      const outcome = await this.deps.executor.run(task, step, priorSteps);

      if (outcome.halt) {
        const t = haltParaTransicao(outcome.halt);
        // Step com halt NUNCA vira `done`: seguir adiante gravaria trabalho pela metade.
        // E o `start` acima já o pôs em `running` — sem o `reopen`, o `nextPending`
        // nunca mais o acharia e a task não retomaria após `nio task approve`.
        if (t.mantemStepPendente) await this.steps.reopen(step.id);
        else await this.steps.failStep(step.id, outcome.halt.reason);
        // Persistir O QUE bloqueou não é telemetria: sem isto o `nio task show`
        // não diz o que liberar e o `approve` não tem alvo — a task fica presa
        // num estado que ninguém sabe destravar.
        await this.tasks.setStatus(task.id, t.status, task.fence, {
          error: t.error,
          ...(t.status === 'waiting_approval'
            ? {
                awaitingKind: outcome.halt.kind === 'question' ? 'question' : 'approval',
                awaitingSubject: outcome.halt.subject,
              }
            : {}),
        });
        this.log('task_halted', {
          taskId: task.id,
          kind: outcome.halt.kind,
          subject: outcome.halt.subject,
        });
        return true;
      }

      await this.steps.finish(step.id, {
        output: outcome.output,
        toolCalls: outcome.toolCalls,
        tokensIn: outcome.tokensIn,
        tokensOut: outcome.tokensOut,
      }); // CHECKPOINT
      await this.tasks.setStatus(task.id, 'running', task.fence, {
        currentStep: step.stepNumber,
        ...(outcome.engineSessionId ? { engineSessionId: outcome.engineSessionId } : {}),
      });
    }
  }

  /** Julga a trilha. `true` = a task terminou (concluída ou falha). */
  private async validar(task: Task, workerId: string): Promise<boolean> {
    await this.conferirLease(task, workerId);
    await this.tasks.setStatus(task.id, 'validating', task.fence);
    const trilha = await this.steps.listByTask(task.id);
    const veredito = await this.deps.validator.judge(task, trilha);

    if (veredito.complete) {
      await this.tasks.complete(task.id, task.fence, veredito.result);
      this.log('task_completed', { taskId: task.id });
      return true;
    }
    if (veredito.nextSteps.length === 0) {
      // Orçamento esgotado — o Validator não tem estado pra isso (fatia 1.7).
      const t = incompletoSemSaida(veredito.nextSteps, veredito.reason);
      await this.tasks.fail(task.id, task.fence, t.error ?? 'sem saída');
      this.log('task_exhausted', { taskId: task.id, reason: veredito.reason });
      return true;
    }
    const base = await this.steps.lastStepNumber(task.id);
    await this.steps.append(
      task.id,
      numberSteps(
        veredito.nextSteps.map((p) => ({ name: p.name, input: { instruction: p.instruction } })),
        base,
      ),
    );
    await this.tasks.setStatus(task.id, 'running', task.fence);
    this.log('task_extended', { taskId: task.id, added: veredito.nextSteps.length });
    return false;
  }
}
