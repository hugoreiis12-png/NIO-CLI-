#!/usr/bin/env node
/**
 * `nio-worker` — o processo que executa as tasks. É ele que cumpre a promessa
 * central: o cliente pode fechar o terminal e a task continua.
 *
 * Binário próprio, não uma thread do `nio-gateway`, por privilégio: o worker roda
 * LLM e shell por minutos e usa o role `nio_worker`, que **não** enxerga
 * `user_cli` nem `auth_sessions` (migration 0012, mesma disciplina do TP-1).
 *
 * Raiz de composição: é aqui — e só aqui — que `adapters/`, `app/` e o wrapper
 * do motor em `tui/` se encontram. O executor declara o stream que precisa
 * (`subscribe`) justamente para não importar `tui/` de dentro de um adapter.
 */
import './lib/load-env.js';
import { TaskRunner } from './app/task-runner.js';
import { createTaskPlanner } from './app/task-planner.js';
import { createTaskValidator } from './app/task-validator.js';
import { createApprovalPolicy } from './app/approval-policy.js';
import { createOpencodeStepExecutor } from './adapters/agent/opencode-executor.js';
import { startOpencode, subscribeEvents } from './tui/opencode.js';
import { loadSession } from './lib/auth/cli-session-store.js';
import { isBinaryInstalled } from './lib/clients/client-install.js';
import { NIO_AI_PROVIDER, NIO_AI_MODEL_ID } from './lib/clients/client-configs.js';
import { claimPidFile, releasePidFile, workerRunning } from './lib/worker/worker-process.js';
import { shutdown } from './lib/shutdown.js';
import { VERSION } from './version.js';
import { randomUUID } from 'node:crypto';

/** Log de uma linha por transição — o worker é headless, stderr é a única janela. */
function log(evento: string, detalhe: Record<string, unknown> = {}): void {
  process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), evento, ...detalhe })}\n`);
}

/** Erro fatal de boot: mensagem clara e saída, sem stack trace de bootstrap. */
async function abortarBoot(motivo: string): Promise<never> {
  log('worker_boot_falhou', { motivo });
  await shutdown(1);
  return process.exit(1);
}

async function main(): Promise<void> {
  // D1/TP-1: role dedicado. Fallback no `NIO_DATABASE_URL` (setup single-role).
  if (process.env.NIO_WORKER_DATABASE_URL?.trim()) {
    process.env.NIO_DATABASE_URL = process.env.NIO_WORKER_DATABASE_URL.trim();
  }

  if (workerRunning()) {
    // Dois workers do mesmo usuário competiriam pelo mesmo recorte da fila. O
    // `SKIP LOCKED` impede corrupção, mas o segundo processo é desperdício.
    log('worker_ja_rodando');
    return shutdown(0);
  }

  const sessao = await loadSession();
  if (!sessao) {
    return abortarBoot('não autenticado — rode `nio login` antes de subir o worker.');
  }
  if (!isBinaryInstalled('opencode')) {
    return abortarBoot('OpenCode não está no PATH — instale com `npm i -g opencode-ai`.');
  }

  const cwd = process.cwd();
  const handle = await startOpencode(cwd);
  const workerId = `${process.pid}-${randomUUID().slice(0, 8)}`;
  claimPidFile();

  const runner = new TaskRunner({
    planner: createTaskPlanner(),
    validator: createTaskValidator(),
    executor: createOpencodeStepExecutor({
      client: handle.client,
      baseUrl: handle.url,
      model: { providerID: NIO_AI_PROVIDER, modelID: NIO_AI_MODEL_ID },
      subscribe: subscribeEvents,
      // Política POR TASK: allowlist do perfil + o que o humano liberou nesta
      // task com `nio task approve`. Concessão não vaza entre tasks.
      deciderFor: (task) => createApprovalPolicy({ approved: task.approvedTools }),
    }),
    onEvent: log,
  });

  const ac = new AbortController();
  const encerrar = (sinal: string): void => {
    log('worker_encerrando', { sinal });
    ac.abort();
  };
  process.on('SIGINT', () => encerrar('SIGINT'));
  process.on('SIGTERM', () => encerrar('SIGTERM'));

  log('worker_pronto', { versao: VERSION, userId: sessao.userId, workerId, cwd });
  try {
    await runner.loop(workerId, sessao.userId, ac.signal);
  } finally {
    handle.close();
    releasePidFile();
  }
  log('worker_encerrado');
  await shutdown(0);
}

void main().catch(async (err: unknown) => {
  log('worker_erro_fatal', { error: err instanceof Error ? err.message : String(err) });
  releasePidFile();
  await shutdown(1);
});
