// `nio open` — abre a IDE da sessão ativa na pasta do projeto (Sprint 2.2).
// Contrapartida manual da abertura automática no fim do `nio init`.
import type { Command } from "commander";
import { loadSession } from "../../lib/auth/session-store.js";
import { createSessionRepository } from "../../adapters/pg/session-repository.js";
import { createIdeGateway } from "../../adapters/ide/ide-gateway.js";
import { writeIdeAutostartTask } from "../../lib/ide-tasks.js";
import { c, sym } from "../../lib/colors.js";
import { brand } from "../../brand.js";

async function runOpen(): Promise<void> {
  const stored = await loadSession();
  if (!stored) {
    console.error(`${c.yellow(sym.warn)} Não autenticado. Rode ${c.cyan(`${brand.name} login`)}.`);
    process.exit(1);
  }

  let session;
  try {
    session = await createSessionRepository().findActiveByUser(stored.userId);
  } catch (err) {
    console.error(`${c.red(sym.err)} Falha no banco: ${(err as Error).message}`);
    process.exit(1);
    return;
  }

  if (!session) {
    console.error(
      `${c.yellow(sym.warn)} Nenhuma sessão ativa. Rode ${c.cyan(`${brand.name} init`)} ou ` +
        `${c.cyan(`${brand.name} sessions activate <id>`)}.`,
    );
    process.exit(1);
    return;
  }

  if (session.ide === "vscode" || session.ide === "cursor") {
    try {
      writeIdeAutostartTask(session.projectPath);
    } catch {
      /* best-effort */
    }
  }

  const result = await createIdeGateway().open(session.ide, session.projectPath);
  switch (result.status) {
    case "opened":
      console.log(`${c.green(sym.ok)} Abrindo ${c.bold(result.binary ?? "")} em ${c.dim(session.projectPath)}`);
      break;
    case "skipped":
      console.log(
        `${c.yellow(sym.warn)} A sessão ${c.bold(session.name)} não tem IDE pra abrir (ide=${session.ide}).`,
      );
      break;
    case "unavailable":
      console.error(`${c.red(sym.err)} ${result.error}`);
      process.exit(1);
      break;
    case "failed":
      console.error(`${c.red(sym.err)} Falha ao abrir a IDE: ${result.error}`);
      process.exit(1);
      break;
  }
}

export function registerOpenCommand(program: Command): void {
  program
    .command("open")
    .description("Abre a IDE da sessão ativa na pasta do projeto")
    .action(runOpen);
}
