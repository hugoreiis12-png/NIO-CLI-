import type { Command } from "commander";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { input, confirm } from "../../lib/prompts.js";
import { section, c, sym } from "../../lib/colors.js";

/**
 * `nio command` — cria um comando (slash-command) personalizado do usuário, no
 * mesmo layout que o `init` provisiona (`~/.config/opencode/commands/<nome>.md`),
 * pra o operador de IA passar a reconhecê-lo.
 */

const NAME_RE = /^[a-z][a-z0-9-]*$/;

function commandPath(name: string): string {
  return join(homedir(), ".config", "opencode", "commands", `${name}.md`);
}

function render(description: string, body: string): string {
  return `---\ndescription: ${description}\n---\n\n${body}\n`;
}

export function registerCommandCommand(program: Command): void {
  program
    .command("command [name]")
    .description("Cria um comando personalizado pro operador de IA")
    .action(async (nameArg?: string) => {
      section("Novo comando", "cria um slash-command personalizado");

      const name = (
        nameArg ??
        (await input({
          message: "Nome do comando (kebab-case, ex.: revisar-pr):",
          validate: (v) => NAME_RE.test(v.trim()) || "Use só minúsculas, dígitos e hífen, começando por letra.",
        }))
      ).trim();

      if (!NAME_RE.test(name)) {
        console.error(`${c.red(sym.err)} Nome inválido "${name}". Use kebab-case (ex.: revisar-pr).`);
        process.exitCode = 1;
        return;
      }

      const path = commandPath(name);
      if (existsSync(path)) {
        const overwrite = await confirm({ message: `Já existe /${name}. Sobrescrever?`, default: false });
        if (!overwrite) {
          console.log("Cancelado.");
          return;
        }
      }

      const description = (await input({
        message: "Descrição curta (o que o comando faz):",
        validate: (v) => v.trim().length > 0 || "A descrição não pode ficar vazia.",
      })).trim();

      const body = (await input({
        message: "Instrução do comando (o prompt que o operador vai seguir):",
        validate: (v) => v.trim().length > 0 || "A instrução não pode ficar vazia.",
      })).trim();

      try {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, render(description, body));
      } catch (err) {
        console.error(`${c.red(sym.err)} Não consegui escrever: ${(err as Error).message}`);
        process.exitCode = 1;
        return;
      }

      console.log(`${c.green(sym.ok)} Comando ${c.bold(`/${name}`)} criado em ${c.dim(path)}.`);
      console.log(`  ${c.dim("Reinicie o operador (OpenCode) pra ele carregar o comando novo.")}`);
    });
}
