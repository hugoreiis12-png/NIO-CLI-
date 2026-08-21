import type { Command } from "commander";
import { brand } from "../../brand.js";
import { existsSync } from "node:fs";
import { runExec, getJob } from "../../lib/exec-delegate.js";
import {
  ENGINES,
  DEFAULT_ENGINE,
  parseEngine,
} from "../../lib/exec-engines.js";

/**
 * Superfície de CLI da delegação headless — o que o nio Studio (Tauri) chama.
 * Contrato: **stdout = JSON** (parseável), **stderr = log ao vivo** (streamável).
 */

function emit(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

export function registerExecCommand(program: Command): void {
  program
    .command("exec")
    .description(
      "Delega a implementação a um agente headless num worktree e aguarda. " +
        "stdout = JSON do resultado; stderr = log ao vivo.",
    )
    .requiredOption(
      "--worktree <path>",
      "worktree onde implementar (criado pelo /implement)",
    )
    .requiredOption(
      "--instruction <texto>",
      "o que implementar (ticket + critérios)",
    )
    .option(
      "--engine <engine>",
      `agente de execução (${ENGINES.join(" | ")})`,
      DEFAULT_ENGINE,
    )
    .option("--quiet", "não streama o log do agente no stderr")
    .action(
      async (opts: {
        worktree: string;
        instruction: string;
        engine?: string;
        quiet?: boolean;
      }) => {
        const engine = parseEngine(opts.engine);
        if (!engine) {
          emit({
            error: `engine inválido: ${opts.engine} — suportados: ${ENGINES.join(", ")}`,
          });
          process.exitCode = 1;
          return;
        }
        if (!existsSync(opts.worktree)) {
          emit({ error: `worktree não encontrado: ${opts.worktree}` });
          process.exitCode = 1;
          return;
        }

        const job = await runExec({
          worktree: opts.worktree,
          instruction: opts.instruction,
          engine,
          echo: opts.quiet !== true,
        });

        emit(job);
        if (job.state !== "done") process.exitCode = 1;
      },
    );

  // Comando separado (não subcomando): opções `required` do pai bloqueariam o parse.
  program
    .command("exec-status <jobId>")
    .description(`Estado de um job de execução (\`${brand.name} exec\`), em JSON`)
    .action((jobId: string) => {
      const job = getJob(jobId);
      if (!job) {
        emit({ error: `job não encontrado: ${jobId}` });
        process.exitCode = 1;
        return;
      }
      emit(job);
    });
}
