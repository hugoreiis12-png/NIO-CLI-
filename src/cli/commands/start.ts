import type { Command } from "commander";
import { continueChain } from "../flows/onboarding.js";

/**
 * `nio start` — conduz a esteira do zero: config → gateway → login → sessão →
 * handoff pro OpenCode. É o mesmo fluxo que `nio` sem argumentos dispara.
 */
export function registerStartCommand(program: Command): void {
  program
    .command("start")
    .description("Conduz a esteira: config → gateway → login → sessão → OpenCode")
    .action(() => continueChain({ from: "cold" }));
}
