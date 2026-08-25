import type { Command } from "commander";
import { syncLangRepos } from "../../adapters/lang/vendor.js";
import { section, c, sym } from "../../lib/colors.js";
import { startSpinner } from "../../spinner.js";

/** `nio lang …` — conhecimento/config das linguagens (server nativo `nio-lang`). */
export function registerLangCommand(program: Command): void {
  const lang = program.command("lang").description("Conhecimento/config das linguagens (nio-lang)");

  lang
    .command("sync")
    .description("Baixa/atualiza o cache de conhecimento das linguagens em ~/.nio/lang")
    .option("--force", "rebaixa mesmo se já houver cache")
    .action(async (opts: { force?: boolean }) => {
      section("nio-lang", "sincronizando conhecimento das linguagens");
      const spinner = startSpinner("Baixando repos…");
      const results = await syncLangRepos({ force: Boolean(opts.force) });
      spinner.stop();

      for (const r of results) {
        const icon = r.status === "failed" ? c.red(sym.err) : c.green(sym.ok);
        const extra = r.error ? c.dim(` (${r.error})`) : "";
        console.log(`  ${icon} ${r.dir} — ${r.status}${extra}`);
      }

      const failed = results.filter((r) => r.status === "failed").length;
      if (failed > 0) {
        console.log(`${c.yellow(sym.warn)} ${failed} repo(s) falharam — o resto do cache segue utilizável.`);
        process.exitCode = 1;
      }
    });
}
