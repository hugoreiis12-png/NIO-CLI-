/**
 * `nio config` — a config compartilhada da equipe (`~/.nio/config.env`).
 * `check` (default) valida; `setup` roda o wizard; `path` imprime o caminho.
 */
import type { Command } from "commander";
import { c, sym } from "../../lib/colors.js";
import { CONFIG_FILE, checkConfig, probeAiBackend, runConfigWizard } from "../../lib/auth/nio-config.js";
import { continueChain } from "../flows/onboarding.js";

const LABEL = { missing: "faltando", invalid: "inválido", unreachable: "sem conexão" } as const;

async function runCheck(opts: { json?: boolean }): Promise<void> {
  const problems = await checkConfig();
  // Backend de IA é consultivo: entra no --json, mas nunca reprova (comandos sem IA seguem ok).
  const ai = await probeAiBackend();
  if (opts.json) {
    console.log(JSON.stringify({ ok: problems.length === 0, problems, aiBackend: ai }));
    process.exit(problems.length ? 1 : 0);
  }
  if (problems.length === 0) {
    console.log(`${c.green(sym.ok)} config ok — NIO_DATABASE_URL, JWT_SECRET e conexão.`);
  } else {
    for (const p of problems) {
      console.log(`${c.red(sym.err)} ${c.bold(p.key)} ${c.dim("— " + LABEL[p.issue])}  ${c.dim(p.hint)}`);
    }
    console.log(`\n${c.dim("Rode")} ${c.cyan("nio config setup")} ${c.dim("pra resolver.")}`);
  }
  // Backend de IA é consultivo: avisa sem reprovar (comandos sem IA seguem ok).
  if (ai.ok) {
    console.log(`${c.green(sym.ok)} backend IA — ${c.dim(ai.detail)}.`);
  } else {
    console.log(
      `${c.yellow(sym.warn)} backend IA — ${c.dim(ai.detail + ".")} ` +
        `${c.dim("nio ai/exec/plan precisam dele; ajuste NIO_AI_BASE_URL/MODEL em ~/.nio/config.env.")}`,
    );
  }
  if (problems.length) process.exit(1);
}

export function registerConfigCommand(program: Command): void {
  const config = program
    .command("config")
    .description("Config compartilhada da equipe (~/.nio/config.env)");

  config
    .command("check", { isDefault: true })
    .description("Confere se a config está completa e o Postgres responde")
    .option("--json", "saída estável em JSON")
    .action(runCheck);

  config
    .command("setup")
    .description("Wizard: cola os valores do time, testa a conexão e salva")
    .action(async () => {
      if (!(await runConfigWizard())) process.exit(1);
      await continueChain({ from: "command" });
    });

  config
    .command("path")
    .description("Imprime o caminho do arquivo de config")
    .action(() => console.log(CONFIG_FILE));
}
