import type { Command } from "commander";
import { existsSync } from "node:fs";
import { runPlan } from "../../lib/exec/plan-delegate.js";

/**
 * Superfície de CLI do planejamento headless — mesmo contrato do `exec`:
 * **stdout = JSON**, **stderr = log ao vivo**, **exit ≠ 0 = falha**.
 */

function emit(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

export function registerPlanCommand(program: Command): void {
  program
    .command("plan")
    .description(
      "Roda o Qwen (vLLM local) sobre o projeto e escreve/refina o plan.md da raiz. " +
        "Não toca código. stdout = JSON do resultado; stderr = log ao vivo.",
    )
    .requiredOption("--instruction <texto>", "a ideia ou o ajuste a planejar")
    .option("--project <path>", "raiz do projeto onde vive o plan.md", process.cwd())
    .option("--quiet", "não streama o log do agente no stderr")
    .action(
      async (opts: {
        instruction: string;
        project: string;
        quiet?: boolean;
      }) => {
        if (!existsSync(opts.project)) {
          emit({ error: `projeto não encontrado: ${opts.project}` });
          process.exitCode = 1;
          return;
        }

        const result = await runPlan({
          project: opts.project,
          instruction: opts.instruction,
          echo: opts.quiet !== true,
        });

        emit(result);
        if (!result.ok) process.exitCode = 1;
      },
    );
}
