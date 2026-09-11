import type { Command } from "commander";
import { existsSync } from "node:fs";
import { runValidatePlan } from "../../lib/exec/validate-plan-delegate.js";

/**
 * Superfície de CLI da triagem — mesmo contrato do `plan`/`exec`:
 * **stdout = JSON**, **stderr = log ao vivo**, **exit ≠ 0 = falha**.
 */

function emit(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

export function registerValidatePlanCommand(program: Command): void {
  program
    .command("validate-plan")
    .description(
      "Lê o plan.md da raiz e roda o Qwen (vLLM local) para julgar se o plano precisa de " +
        "uma spec antes de implementar. stdout = JSON { ok, needsSpec, reason, suggestedSlug?, engine }; " +
        "stderr = log. suggestedSlug (slug do worktree) só sai quando needsSpec.",
    )
    .option("--project <path>", "raiz do projeto onde vive o plan.md", process.cwd())
    .option("--quiet", "não streama o log do agente no stderr")
    .action(
      async (opts: { project: string; quiet?: boolean }) => {
        if (!existsSync(opts.project)) {
          emit({ ok: false, error: `projeto não encontrado: ${opts.project}` });
          process.exitCode = 1;
          return;
        }

        const result = await runValidatePlan({
          project: opts.project,
          echo: opts.quiet !== true,
        });

        emit(result);
        if (!result.ok) process.exitCode = 1;
      },
    );
}
