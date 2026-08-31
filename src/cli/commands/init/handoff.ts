import { spawn } from "node:child_process";
import { isBinaryInstalled } from "../../../lib/clients/client-install.js";
import { section, c, sym } from "../../../lib/colors.js";

/**
 * Handoff final: entrega o ambiente materializado pro operador de IA fixo
 * (OpenCode — decisão de 2026-07-27). Se o binário não estiver no PATH, só
 * orienta em vez de falhar. Módulo isolado (sem ciclo de import) porque tanto o
 * `nio init` quanto a esteira (`onboarding.ts`) chamam isto no fim.
 */
export async function handoffToOperator(): Promise<void> {
  console.log("");
  section("Handoff", "entregando a sessão pro OpenCode");
  if (!isBinaryInstalled("opencode")) {
    console.log(
      `  ${c.yellow(sym.warn)} OpenCode não encontrado no PATH. Instale e rode \`opencode\` ` +
        "nesta pasta pra continuar.",
    );
    return;
  }
  await new Promise<void>((resolve) => {
    const child = spawn("opencode", [], { stdio: "inherit" });
    child.on("exit", () => resolve());
    child.on("error", (err) => {
      console.error(`[erro] Falha ao iniciar o OpenCode: ${err.message}`);
      resolve();
    });
  });
}
