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
import { SECTIONS, TAGLINE } from "./docs/content.js";
import { commandSection, toolSection } from "./docs/dynamic.js";
import { renderTerminal } from "./docs/terminal.js";
import { renderHtml } from "./docs/html.js";

function allSections(program: Command) {
  return [...SECTIONS, commandSection(program), toolSection()];
}

export function registerDocsCommand(program: Command): void {
  program
    .command("docs")
    .description("Documentação completa da CLI (terminal ou página com --html)")
    .option("--html", "gera a página HTML em vez de imprimir no terminal")
    .option("--open", "abre a página no navegador (implica --html)")
    .option("-o, --out <path>", "caminho do HTML (default ~/.nio/nio-docs.html)")
    .action((opts: { html?: boolean; open?: boolean; out?: string }) => {
      const sections = allSections(program);

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
