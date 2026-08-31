import { launchAiClient, HeadroomRequiredError } from "../../../app/ai-client.js";
import { brand } from "../../../brand.js";
import { section, c, sym } from "../../../lib/colors.js";

/**
 * Handoff final: sobe o Headroom (obrigatório) e entrega o terminal pro OpenCode.
 * Se o Headroom não sobe (sem Docker), **não derruba o init** — orienta a rodar
 * `nio ai` depois. Módulo isolado (sem ciclo de import).
 */
export async function handoffToOperator(cwd: string = process.cwd()): Promise<void> {
  console.log("");
  section("Handoff", "entregando a sessão pro OpenCode (via Headroom)");
  try {
    await launchAiClient({ cwd });
  } catch (err) {
    if (err instanceof HeadroomRequiredError) {
      console.log(`  ${c.yellow(sym.warn)} ${err.message}`);
      console.log(`  ${c.dim(`suba o Docker e rode \`${brand.name} ai\` pra entrar na sessão.`)}`);
      return;
    }
    throw err;
  }
}
