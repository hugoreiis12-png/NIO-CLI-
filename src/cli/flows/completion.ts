import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { brand } from "../../brand.js";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { confirm } from "../../lib/prompts.js";
import { c, sym, cmd } from "../../lib/colors.js";

/**
 * Oferta de autocomplete do shell. `init` chama pra oferecer; `sync` chama pra validar
 * (se já está no rc) e, se não, promptar o mesmo. Idempotente — só acrescenta a linha se
 * ainda não existir.
 */

type Shell = "bash" | "zsh" | "fish";

function detectShell(): Shell | null {
  const sh = (process.env.SHELL ?? "").split("/").pop();
  return sh === "bash" || sh === "zsh" || sh === "fish" ? sh : null;
}

/** rc do shell + a linha que ativa o completion do nio. */
function rcInfo(shell: Shell): { path: string; line: string } {
  const home = homedir();
  if (shell === "fish") {
    return {
      path: join(home, ".config", "fish", "config.fish"),
      line: `${brand.name} completion fish | source`,
    };
  }
  return {
    path: join(home, shell === "zsh" ? ".zshrc" : ".bashrc"),
    line: `eval "$(${brand.name} completion ${shell})"`,
  };
}

function isConfigured(path: string): boolean {
  return existsSync(path) && readFileSync(path, "utf8").includes(`${brand.name} completion`);
}

const tilde = (p: string) => p.replace(homedir(), "~");

/**
 * Oferece adicionar o autocomplete ao rc. `announceConfigured` mostra um ok quando já
 * está (útil no `init`); no `sync` deixe `false` pra não poluir quando não há nada a fazer.
 */
export async function offerShellCompletion(opts: {
  interactive: boolean;
  assumeYes?: boolean;
  announceConfigured?: boolean;
}): Promise<void> {
  const shell = detectShell();
  if (!shell) return; // shell desconhecido → nada a oferecer

  const { path, line } = rcInfo(shell);
  if (isConfigured(path)) {
    if (opts.announceConfigured) {
      console.log(`  ${c.green(sym.ok)} ${c.dim(`autocomplete já configurado (${shell})`)}`);
    }
    return;
  }

  console.log("");
  console.log(`  ${c.dim(`autocomplete do ${brand.name} (${shell}):`)} ${cmd(line)}`);
  const add =
    opts.assumeYes === true ||
    (opts.interactive &&
      (await confirm({ message: `Adicionar ao ${tilde(path)}?`, default: true })));
  if (!add) {
    console.log(`  ${c.dim("pulado — cole a linha acima no seu rc quando quiser.")}`);
    return;
  }

  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `\n# ${brand.name} completion\n${line}\n`);
    console.log(
      `  ${c.green(sym.ok)} ${c.dim(`adicionado a ${tilde(path)} — abra um shell novo (ou`)} ` +
        `${cmd(`source ${tilde(path)}`)}${c.dim(").")}`,
    );
  } catch (err) {
    console.error(`  ${c.red(sym.err)} ${c.dim(`não consegui escrever em ${tilde(path)}: ${(err as Error).message}`)}`);
  }
}
