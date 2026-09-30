// Tasks CLI: cria, lista e inspeciona a execução durável. Superfície fina sobre o
// `TaskManager` (app layer) — resolução por prefixo e regras de cancelamento vivem lá.
// Não importa os repositórios direto: `app/task-boundary.test.ts` falha o build se alguém tentar.
import type { Command } from "commander";
import { loadSession } from "../../lib/auth/cli-session-store.js";
import {
  TaskManager,
  TaskNotFoundError,
  AmbiguousTaskError,
  TaskNotCancellableError,
  TaskNotAwaitingError,
  TaskAwaitsAnswerError,
} from "../../app/task-manager.js";
import { SessionManager } from "../../app/session-manager.js";
import { createProfileCatalog } from "../../profiles/index.js";
import type { Task, TaskStep } from "../../core/tasks.js";
import type { Profile } from "../../core/types.js";
import { section, c, sym } from "../../lib/colors.js";
import { brand } from "../../brand.js";
import { ensureWorkerRunning } from "../../lib/worker/worker-process.js";

const STATUS_STYLE: Record<string, (t: string) => string> = {
  pending: c.dim,
  planning: c.cyan,
  running: c.cyan,
  validating: c.cyan,
  waiting_approval: c.yellow,
  completed: c.green,
  failed: c.red,
  cancelled: c.dim,
};

const STEP_STYLE: Record<string, (t: string) => string> = {
  pending: c.dim,
  running: c.cyan,
  done: c.green,
  failed: c.red,
  skipped: c.dim,
};

async function requireUserId(): Promise<number> {
  const stored = await loadSession();
  if (!stored) {
    console.error(`${c.yellow(sym.warn)} Não autenticado. Rode ${c.cyan(`${brand.name} login`)}.`);
    process.exit(1);
  }
  return stored.userId;
}

/** Roda `fn` com o manager; erro de resolução vira mensagem + exit 1. */
async function withManager(fn: (m: TaskManager, userId: number) => Promise<void>): Promise<void> {
  const userId = await requireUserId();
  try {
    await fn(new TaskManager(), userId);
  } catch (err) {
    if (
      err instanceof TaskNotFoundError ||
      err instanceof AmbiguousTaskError ||
      err instanceof TaskNotCancellableError ||
      err instanceof TaskNotAwaitingError ||
      err instanceof TaskAwaitsAnswerError
    ) {
      console.error(`${c.red(sym.err)} ${err.message} Veja ${c.cyan(`${brand.name} task list`)}.`);
    } else {
      console.error(`${c.red(sym.err)} Falha no banco: ${(err as Error).message}`);
    }
    process.exit(1);
  }
}

/** Perfil válido do catálogo — fonte única, sem lista solta no comando. */
function parseProfile(valor: string): Profile {
  const validos = createProfileCatalog().list().map((d) => d.profile);
  const achado = validos.find((p) => p === valor);
  if (!achado) {
    console.error(
      `${c.red(sym.err)} Perfil "${valor}" não existe. Disponíveis: ${validos.join(", ")}.`,
    );
    process.exit(1);
  }
  return achado;
}

/** Teto de steps: inteiro > 0. Valor inválido é erro do chamador, não default silencioso. */
function parseMaxSteps(valor: string | undefined): number | undefined {
  if (valor === undefined) return undefined;
  const n = Number(valor);
  if (!Number.isInteger(n) || n <= 0) {
    console.error(`${c.red(sym.err)} --max-steps precisa ser um inteiro > 0 (recebi "${valor}").`);
    process.exit(1);
  }
  return n;
}

/**
 * De onde a task nasce: a sessão ativa dá proveniência e perfil. Sem sessão
 * ativa a task ainda é válida (`session_id` é proveniência, não escopo), mas o
 * perfil passa a ser obrigatório — é ele que define a allowlist de aprovação.
 */
async function resolveOrigem(
  userId: number,
  profileFlag: string | undefined,
): Promise<{ sessionId: string | null; profile: Profile }> {
  if (profileFlag) {
    const ativa = await new SessionManager().findActive(userId).catch(() => null);
    return { sessionId: ativa?.id ?? null, profile: parseProfile(profileFlag) };
  }
  const ativa = await new SessionManager().findActive(userId);
  if (!ativa) {
    console.error(
      `${c.yellow(sym.warn)} Sem sessão ativa. Rode ${c.cyan(`${brand.name} init`)} ` +
        `ou informe ${c.cyan("--profile <perfil>")}.`,
    );
    process.exit(1);
  }
  return { sessionId: ativa.id, profile: ativa.profile };
}

function printTaskRow(t: Task): void {
  const style = STATUS_STYLE[t.status] ?? c.dim;
  const goal = t.goal.length > 44 ? `${t.goal.slice(0, 43)}…` : t.goal;
  console.log(
    `  ${c.dim(t.id.slice(0, 8))}  ${goal.padEnd(45)} ${c.dim(t.profile.padEnd(10))} ${style(t.status)}`,
  );
}

function printStep(s: TaskStep): void {
  const style = STEP_STYLE[s.status] ?? c.dim;
  const tentativa = s.attempt > 1 ? c.dim(` (tentativa ${s.attempt})`) : "";
  const erro = s.error ? `\n      ${c.red(s.error)}` : "";
  console.log(`  ${c.dim(String(s.stepNumber).padStart(3))}  ${style(s.status.padEnd(8))} ${s.name}${tentativa}${erro}`);
}

async function run(goalParts: string[], opts: { profile?: string; maxSteps?: string }): Promise<void> {
  const goal = goalParts.join(" ").trim();
  if (!goal) {
    console.error(`${c.red(sym.err)} Descreva o objetivo da task.`);
    process.exit(1);
  }
  await withManager(async (m, userId) => {
    const origem = await resolveOrigem(userId, opts.profile);
    const maxSteps = parseMaxSteps(opts.maxSteps);
    const task = await m.create({
      userId,
      sessionId: origem.sessionId,
      profile: origem.profile,
      goal,
      ...(maxSteps !== undefined ? { maxSteps } : {}),
    });
    console.log(`${c.green(sym.ok)} Task ${c.bold(task.id.slice(0, 8))} criada e enfileirada.`);

    // Sobe o worker se não houver um vivo. A task já está persistida, então
    // mesmo que isto falhe ela não se perde — o próximo worker a encontra.
    const worker = ensureWorkerRunning();
    if (worker.status === 'iniciado') {
      console.log(`  ${c.dim(`worker iniciado (pid ${worker.pid}) — pare com \`kill ${worker.pid}\``)}`);
    } else if (worker.status === 'falhou') {
      console.log(
        `  ${c.yellow(sym.warn)} não consegui subir o worker (${worker.error}). ` +
          `A task fica na fila; rode ${c.cyan('nio-worker')} à mão.`,
      );
    }
    console.log(`  ${c.dim(`acompanhe com ${brand.name} task show ${task.id.slice(0, 8)}`)}`);
  });
}

async function list(opts: { limit?: string; all?: boolean }): Promise<void> {
  await withManager(async (m, userId) => {
    const limite = opts.limit ? Number(opts.limit) : undefined;
    const tasks = await m.list(userId, {
      ...(limite !== undefined ? { limit: limite } : {}),
      ...(opts.all ? { kinds: ["agent", "chat"] } : {}),
    });
    if (tasks.length === 0) {
      console.log(`Nenhuma task ainda. Crie uma com ${c.cyan(`${brand.name} task run "<objetivo>"`)}.`);
      return;
    }
    section("Tasks", `${tasks.length} do usuário (id abreviado · objetivo · perfil · status)`);
    for (const t of tasks) printTaskRow(t);
  });
}

async function show(id: string): Promise<void> {
  await withManager(async (m, userId) => {
    const { task, steps } = await m.show(userId, id);
    const style = STATUS_STYLE[task.status] ?? c.dim;
    section(`Task ${task.id.slice(0, 8)}`, task.goal);
    console.log(`  status   ${style(task.status)}`);
    console.log(`  perfil   ${task.profile}`);
    console.log(`  criada   ${task.createdAt.toISOString()}`);
    if (task.error) console.log(`  erro     ${c.red(task.error)}`);
    if (task.awaitingKind === "approval") {
      console.log(`  travada  ${c.yellow(task.awaitingSubject ?? "?")} precisa de aprovação`);
      console.log(`  ${c.dim(`libere com ${brand.name} task approve ${task.id.slice(0, 8)}`)}`);
    } else if (task.awaitingKind === "question") {
      console.log(`  travada  ${c.yellow("o motor perguntou:")} ${task.awaitingSubject ?? "?"}`);
    }
    if (task.approvedTools.length > 0) {
      console.log(`  liberado ${c.dim(task.approvedTools.join(", "))}`);
    }
    if (task.result) console.log(`\n${task.result}\n`);

    if (steps.length === 0) {
      // Sem plano ainda: é o estado normal enquanto a task espera na fila.
      console.log(`\n  ${c.dim("sem steps ainda — a task ainda não foi planejada")}`);
      return;
    }
    console.log(`\n  ${c.dim("steps (nº · status · nome)")}`);
    for (const s of steps) printStep(s);
  });
}

export function registerTaskCommand(program: Command): void {
  const cmd = program
    .command("task")
    .description("Execução durável: cria e acompanha tasks (run/list/show/cancel)");

  cmd
    .command("run <goal...>")
    .description("Cria uma task a partir de um objetivo e enfileira")
    .option("--profile <perfil>", "Perfil da task (default: o da sessão ativa)")
    .option("--max-steps <n>", "Teto de steps (default: 25)")
    .action(run);

  cmd
    .command("list", { isDefault: true })
    .description("Lista as suas tasks")
    .option("--limit <n>", "Quantas listar (default: 50, máx 200)")
    .option("--all", "Inclui os turnos do chat (nio ai), não só trabalho de agente")
    .action(list);

  cmd.command("show <id>").description("Mostra a task e a trilha de steps").action(show);

  cmd
    .command("approve <id>")
    .description("Libera a ferramenta que travou a task e devolve à fila")
    .action(async (id: string) => {
      await withManager(async (m, userId) => {
        const t = await m.approve(userId, id);
        const liberada = t.approvedTools[t.approvedTools.length - 1];
        console.log(
          `${c.green(sym.ok)} Liberado ${c.bold(liberada ?? "?")} para a task ${c.bold(t.id.slice(0, 8))}.`,
        );
        console.log(`  ${c.dim("a task voltou para a fila — o worker retoma do passo que parou")}`);
      });
    });

  cmd
    .command("cancel <id>")
    .description("Cancela uma task que ainda não terminou")
    .action(async (id: string) => {
      await withManager(async (m, userId) => {
        const t = await m.cancel(userId, id);
        console.log(`${c.yellow(sym.ok)} Task ${c.bold(t.id.slice(0, 8))} cancelada.`);
      });
    });
}
