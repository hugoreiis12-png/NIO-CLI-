// `nio deps` — DependencyWatcher (Sprint 3): detecta deps declaradas nos manifests
// da sessão ativa, registra eventos e (opt-in) instala. `scan` = um ciclo; `watch`
// = loop de 10s até Ctrl+C. Auto-install só com `--install` (decisão de escopo).
import type { Command } from "commander";
import { loadSession } from "../../lib/auth/session-store.js";
import { createSessionRepository } from "../../adapters/pg/session-repository.js";
import { createDependencyEventRepository } from "../../adapters/pg/dependency-event-repository.js";
import { DependencyWatcher, type TickResult } from "../../app/dependency-watcher.js";
import type { Session } from "../../core/types.js";
import { section, c, sym } from "../../lib/colors.js";
import { brand } from "../../brand.js";

/** Resolve a sessão ativa do usuário logado, ou encerra com mensagem clara. */
async function requireActiveSession(): Promise<Session> {
  const stored = await loadSession();
  if (!stored) {
    console.error(`${c.yellow(sym.warn)} Não autenticado. Rode ${c.cyan(`${brand.name} login`)}.`);
    process.exit(1);
  }
  let session: Session | null;
  try {
    session = await createSessionRepository().findActiveByUser(stored.userId);
  } catch (err) {
    console.error(`${c.red(sym.err)} Falha no banco: ${(err as Error).message}`);
    process.exit(1);
    throw err; // inalcançável — só pro type narrowing
  }
  if (!session) {
    console.error(
      `${c.yellow(sym.warn)} Nenhuma sessão ativa. Rode ${c.cyan(`${brand.name} init`)} ou ` +
        `${c.cyan(`${brand.name} sessions activate <id>`)}.`,
    );
    process.exit(1);
  }
  return session;
}

/** Imprime o resultado de um ciclo de scan. */
function renderTick(result: TickResult): void {
  if (result.recorded.length === 0 && result.missing.length === 0) {
    console.log(`  ${c.dim(sym.bullet)} nada novo (${result.scanned} deps declaradas, tudo instalado)`);
    return;
  }
  for (const dep of result.missing) {
    const isNew = result.recorded.some((e) => e.dependencyName === dep.name && e.filePath === dep.filePath);
    const tag = isNew ? c.yellow("novo") : c.dim("pendente");
    console.log(`  ${c.yellow(sym.arrow)} ${dep.name} ${c.dim(`(${dep.type} · ${dep.filePath})`)} ${tag}`);
  }
  for (const type of result.installed) {
    console.log(`  ${c.green(sym.ok)} instalado: dependências ${type}`);
  }
}

function makeWatcher(session: Session, autoInstall: boolean): DependencyWatcher {
  return new DependencyWatcher({
    repo: createDependencyEventRepository(),
    autoInstall,
    log: (line) => console.log(`  ${c.dim(line)}`),
  });
}

async function runScan(opts: { install?: boolean }): Promise<void> {
  const session = await requireActiveSession();
  section("Dependências", `scan de ${c.dim(session.projectPath)}${opts.install ? " (auto-install)" : ""}`);
  try {
    const result = await makeWatcher(session, Boolean(opts.install)).tick(session);
    renderTick(result);
  } catch (err) {
    console.error(`${c.red(sym.err)} Falha no scan: ${(err as Error).message}`);
    process.exit(1);
  }
}

async function runWatch(opts: { install?: boolean }): Promise<void> {
  const session = await requireActiveSession();
  section(
    "Dependências",
    `watch de ${c.dim(session.projectPath)} a cada 10s${opts.install ? " (auto-install)" : ""} — Ctrl+C encerra`,
  );

  const controller = new AbortController();
  process.on("SIGINT", () => {
    console.log(`\n${c.dim("encerrando watch...")}`);
    controller.abort();
  });

  try {
    await makeWatcher(session, Boolean(opts.install)).watch(session, controller.signal, (result) => {
      console.log(c.dim(`— ${new Date().toLocaleTimeString()}`));
      renderTick(result);
    });
  } catch (err) {
    console.error(`${c.red(sym.err)} Falha no watch: ${(err as Error).message}`);
    process.exit(1);
  }
}

export function registerDepsCommand(program: Command): void {
  const cmd = program.command("deps").description("Detecta e (opt-in) instala dependências da sessão ativa");

  cmd
    .command("scan", { isDefault: true })
    .description("Escaneia os manifests uma vez e registra o que falta")
    .option("--install", "instala o que estiver faltando (senão, só detecta e registra)")
    .action(runScan);

  cmd
    .command("watch")
    .description("Escaneia a cada 10s até Ctrl+C")
    .option("--install", "instala o que estiver faltando a cada ciclo")
    .action(runWatch);
}
