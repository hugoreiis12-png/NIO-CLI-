/**
 * `nio config` — a config compartilhada da equipe (`~/.nio/config.env`).
 * `check` (default) valida; `setup` roda o wizard; `path` imprime o caminho.
 */
import type { Command } from "commander";
import { c, sym } from "../../lib/colors.js";
import { CONFIG_FILE, checkConfig, runConfigWizard } from "../../lib/auth/nio-config.js";

const LABEL = { missing: "faltando", invalid: "inválido", unreachable: "sem conexão" } as const;

async function runCheck(opts: { json?: boolean }): Promise<void> {
  const problems = await checkConfig();
  if (opts.json) {
    console.log(JSON.stringify({ ok: problems.length === 0, problems }));
    process.exit(problems.length ? 1 : 0);
  }
  if (problems.length === 0) {
    console.log(`${c.green(sym.ok)} config ok — NIO_DATABASE_URL, JWT_SECRET e conexão.`);
    return;
  }
  for (const p of problems) {
    console.log(`${c.red(sym.err)} ${c.bold(p.key)} ${c.dim("— " + LABEL[p.issue])}  ${c.dim(p.hint)}`);
  }
  console.log(`\n${c.dim("Rode")} ${c.cyan("nio config setup")} ${c.dim("pra resolver.")}`);
  process.exit(1);
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
      const ok = await runConfigWizard();
      process.exit(ok ? 0 : 1);
    });

  config
    .command("path")
    .description("Imprime o caminho do arquivo de config")
    .action(() => console.log(CONFIG_FILE));
}
