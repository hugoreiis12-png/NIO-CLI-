/**
 * Registro leve do `nio init`: só declara o comando. O wizard inteiro
 * (`./index.js`, ~45 imports) é carregado sob demanda no `.action` — fora do
 * caminho quente do cold-start, que só precisa da árvore de comandos.
 */
import type { Command } from "commander";
import { brand } from "../../../brand.js";

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description(`Cria ${brand.projectConfigFile} no diretório atual e materializa o ambiente da sessão`)
    .action(async () => {
      const { runInitWizard } = await import("./index.js");
      await runInitWizard();
    });
}
