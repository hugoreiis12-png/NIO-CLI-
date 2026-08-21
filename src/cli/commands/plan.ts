import type { Command } from "commander";
import { existsSync } from "node:fs";
import { runPlan } from "../../lib/plan-delegate.js";
import { ENGINES, PLAN_ENGINE, parseEngine } from "../../lib/exec-engines.js";

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
      "Roda o engine pensante sobre o projeto e escreve/refina o plan.md da raiz. " +
        "Não toca código. stdout = JSON do resultado; stderr = log ao vivo.",
    )
    .requiredOption("--instruction <texto>", "a ideia ou o ajuste a planejar")
    .option("--project <path>", "raiz do projeto onde vive o plan.md", process.cwd())
    .option(
      "--engine <engine>",
      `agente pensante (${ENGINES.join(" | ")})`,
      PLAN_ENGINE,
    )
    .option("--quiet", "não streama o log do agente no stderr")
    .action(
      async (opts: {
        instruction: string;
        project: string;
        engine?: string;
        quiet?: boolean;
      }) => {
        const engine = parseEngine(opts.engine, PLAN_ENGINE);
        if (!engine) {
          emit({
            error: `engine inválido: ${opts.engine} — suportados: ${ENGINES.join(", ")}`,
          });
          process.exitCode = 1;
          return;
        }
        if (!existsSync(opts.project)) {
          emit({ error: `projeto não encontrado: ${opts.project}` });
          process.exitCode = 1;
          return;
        }

        const result = await runPlan({
          project: opts.project,
          instruction: opts.instruction,
          engine,
          echo: opts.quiet !== true,
        });

        emit(result);
        if (!result.ok) process.exitCode = 1;
      },
    );
}
