/**
 * `nio ai` — sobe o client de IA da sessão ativa: Headroom (obrigatório, ADR 0007)
 * + OpenCode no diretório do projeto. É o que a task da IDE roda ao abrir a pasta,
 * e o que o `nio init` chama no fim.
 */
import type { Command } from "commander";
import { brand } from "../../brand.js";
import { c, sym } from "../../lib/colors.js";
import { loadSession } from "../../lib/auth/session-store.js";
import { createSessionRepository } from "../../adapters/pg/session-repository.js";
import { headroomHealthy, HEADROOM_URL } from "../../lib/headroom.js";
import { launchAiClient, HeadroomRequiredError } from "../../app/ai-client.js";
import type { Session } from "../../core/types.js";

/** Sessão ativa do usuário logado, ou encerra (padrão de `nio open`/`nio docker`). */
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
    throw err;
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

async function runAi(): Promise<void> {
  const session = await requireActiveSession();
  try {
    const code = await launchAiClient({ cwd: session.projectPath });
    if (code !== 0) process.exitCode = code;
  } catch (err) {
    if (err instanceof HeadroomRequiredError) {
      console.error(`${c.red(sym.err)} ${err.message}`);
      console.error(c.dim(`  suba o Docker e rode \`${brand.name} docker headroom up\`, ou tente de novo.`));
      process.exit(1);
    }
    throw err;
  }
}

export function registerAiCommand(program: Command): void {
  const ai = program
    .command("ai")
    .description("Sobe o client de IA da sessão ativa (Headroom + OpenCode no projeto)")
    .action(runAi);

  ai
    .command("status")
    .description("Estado do Headroom (proxy obrigatório do client de IA)")
    .action(async () => {
      const up = await headroomHealthy();
      console.log(
        `${up ? c.green(sym.ok) : c.red(sym.err)} Headroom ${c.dim(HEADROOM_URL)} — ${up ? "no ar" : "fora"}`,
      );
      if (!up) console.log(c.dim(`  suba com \`${brand.name} docker headroom up\``));
    });
}
