/**
 * `nio docs` — documentação completa da CLI em duas formas: no terminal
 * (default) ou como página HTML autocontida (`--html`, com `--open`).
 * Conteúdo em `docs/content.ts` + seções geradas ao vivo (`docs/dynamic.ts`).
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "commander";
import { VERSION } from "../../version.js";
import { c, sym } from "../../lib/colors.js";
import { openUrl } from "../../lib/open-url.js";
import { homePath } from "../../brand.js";

export function registerDocsCommand(program: Command): void {
  program
    .command("docs")
    .description("Documentação completa da CLI (terminal ou página com --html)")
    .option("--html", "gera a página HTML em vez de imprimir no terminal")
    .option("--open", "abre a página no navegador (implica --html)")
    .option("-o, --out <path>", "caminho do HTML (default ~/.nio/nio-docs.html)")
    .action(async (opts: { html?: boolean; open?: boolean; out?: string }) => {
      // Conteúdo/render (SECTIONS, terminal, html) importados sob demanda: pesam
      // ~107ms e só o `nio docs` os usa — fora do caminho quente do cold-start.
      const [{ SECTIONS, TAGLINE }, { commandSection, toolSection }, { renderTerminal }, { renderHtml }] =
        await Promise.all([
          import("./docs/content.js"),
          import("./docs/dynamic.js"),
          import("./docs/terminal.js"),
          import("./docs/html.js"),
        ]);
      const sections = [...SECTIONS, commandSection(program), toolSection()];

      if (!opts.html && !opts.open) {
        console.log(renderTerminal(sections, VERSION));
        return;
      }

      const out = resolve(opts.out ?? homePath("nio-docs.html"));
      writeFileSync(out, renderHtml(sections, VERSION, TAGLINE), "utf8");
      console.log(`${c.green(sym.ok)} página gerada: ${c.cyan(out)}`);
      if (opts.open) openUrl(out);
    });
}
