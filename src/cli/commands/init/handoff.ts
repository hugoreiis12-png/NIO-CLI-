import { HeadroomRequiredError } from "../../../app/ai-client.js";
import { brand } from "../../../brand.js";
import { section, c, sym } from "../../../lib/colors.js";

/**
 * Handoff final: `launchNioTui` (import lazy) — Headroom + interface NIO (Ink).
 * Headroom fora (sem Docker) → não derruba o init, orienta a rodar `nio ai`.
 */
export async function handoffToOperator(cwd: string = process.cwd()): Promise<void> {
  console.log("");
  section("Handoff", "abrindo a interface NIO (via Headroom)");
  try {
    const { launchNioTui } = await import("../../../tui/index.js");
    await launchNioTui({ cwd });
  } catch (err) {
    if (err instanceof HeadroomRequiredError) {
      console.log(`  ${c.yellow(sym.warn)} ${err.message}`);
      console.log(`  ${c.dim(`suba o Docker e rode \`${brand.name} ai\` pra entrar na sessão.`)}`);
      return;
    }
    throw err;
  }
}
