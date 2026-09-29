/**
 * Esqueleto do `Command` — nome, versão, help e logo. Sem nenhum comando.
 *
 * Existe separado para que o caminho de execução da CLI (`program-lazy`) monte o
 * programa sem importar os ~20 módulos de comando. Importar `program.ts`, que os
 * traz todos estaticamente, custava 159 ms — 93% do cold start.
 */
import { Command } from "commander";
import { VERSION } from "../version.js";
import { brand } from "../brand.js";
import { renderMatrixLogo, shouldDrawLogo } from "../matrix-logo.js";
import { usageGuide } from "./help-guide.js";

export function createBaseProgram(logoShown: () => boolean = () => false): Command {
  const program = new Command();
  program
    .name(brand.name)
    .description(
      `CLI do ${brand.productName} (${brand.productFullName}) — rode \`nio\` sem argumentos pra esteira guiada`,
    )
    .version(VERSION)
    .addHelpText("beforeAll", () => (logoShown() || !shouldDrawLogo() ? "" : renderMatrixLogo()))
    // só no help do topo (`nio --help`), não no de cada subcomando
    .addHelpText("after", (ctx) => (ctx.command.name() === brand.name ? usageGuide() : ""));
  return program;
}
