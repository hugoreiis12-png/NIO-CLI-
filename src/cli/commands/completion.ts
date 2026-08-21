import type { Command } from "commander";
import { c, cmd } from "../../lib/colors.js";
import { brand } from "../../brand.js";

/** Nome do binário — vai literal nos scripts de completion gerados. */
const bin = brand.name;

/**
 * `nio completion [bash|zsh|fish]` — emite um script de autocomplete gerado da árvore
 * atual do commander (comandos + subcomandos + flags). O usuário faz
 * `eval "$(nio completion zsh)"` no rc, e aí `nio <TAB>` sugere. Sem dependência.
 */

interface CmdNode {
  name: string;
  subs: CmdNode[];
  opts: string[];
}

function optFlags(command: Command): string[] {
  const flags: string[] = [];
  const opts = command.options as unknown as Array<{ long?: string; short?: string }>;
  for (const o of opts) {
    if (o.long) flags.push(o.long);
    if (o.short) flags.push(o.short);
  }
  flags.push("--help");
  return flags;
}

function walk(command: Command): CmdNode {
  return {
    name: command.name(),
    subs: command.commands.map(walk),
    opts: optFlags(command),
  };
}

/** Candidatos no nível 2 de um comando: seus subcomandos + suas flags. */
function level2(node: CmdNode): string {
  return [...node.subs.map((s) => s.name), ...node.opts].join(" ");
}

function bashScript(root: CmdNode): string {
  const top = root.subs.map((s) => s.name).join(" ");
  const arms = root.subs
    .filter((s) => s.subs.length > 0 || s.opts.length > 1)
    .map((s) => `    ${s.name}) __c="${level2(s)}" ;;`)
    .join("\n");
  return `# ${bin} bash completion — gere com: ${bin} completion bash
_${bin}() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local __c=""
  if [ "\$COMP_CWORD" -eq 1 ]; then
    __c="${top}"
  else
    case "\${COMP_WORDS[1]}" in
${arms}
    *) __c="--help" ;;
    esac
  fi
  COMPREPLY=( \$(compgen -W "\$__c" -- "\$cur") )
}
complete -F _${bin} ${bin}`;
}

function zshScript(root: CmdNode): string {
  const top = root.subs.map((s) => s.name).join(" ");
  const arms = root.subs
    .filter((s) => s.subs.length > 0 || s.opts.length > 1)
    .map((s) => `      ${s.name}) __c=(${level2(s)}) ;;`)
    .join("\n");
  return `#compdef ${bin}
# ${bin} zsh completion — gere com: ${bin} completion zsh
_${bin}() {
  local -a __c
  if (( CURRENT == 2 )); then
    __c=(${top})
  else
    case $words[2] in
${arms}
    *) __c=(--help) ;;
    esac
  fi
  compadd -a __c
}
compdef _${bin} ${bin}`;
}

function fishScript(root: CmdNode): string {
  const lines: string[] = [
    `# ${bin} fish completion — gere com: ${bin} completion fish`,
    `complete -c ${bin} -f`,
  ];
  const top = root.subs.map((s) => s.name).join(" ");
  lines.push(`complete -c ${bin} -n '__fish_use_subcommand' -a '${top}'`);
  for (const s of root.subs) {
    const cands = [...s.subs.map((x) => x.name), ...s.opts].join(" ");
    lines.push(
      `complete -c ${bin} -n '__fish_seen_subcommand_from ${s.name}' -a '${cands}'`,
    );
  }
  return lines.join("\n");
}

type Shell = "bash" | "zsh" | "fish";

function detectShell(): Shell | null {
  const sh = (process.env.SHELL ?? "").split("/").pop();
  if (sh === "bash" || sh === "zsh" || sh === "fish") return sh;
  return null;
}

export function registerCompletionCommand(program: Command): void {
  program
    .command("completion [shell]")
    .description(
      `Imprime o script de autocomplete (bash|zsh|fish). Ex.: eval "$(${bin} completion zsh)"`,
    )
    .action((shellArg?: string) => {
      const shell = (shellArg as Shell) ?? detectShell();
      if (shell !== "bash" && shell !== "zsh" && shell !== "fish") {
        console.error(
          `${c.yellow("shell não reconhecido.")} Use: ${cmd(`${bin} completion`)} ` +
            `${c.dim("bash|zsh|fish")}`,
        );
        process.exitCode = 1;
        return;
      }
      const root = walk(program);
      const script =
        shell === "bash"
          ? bashScript(root)
          : shell === "zsh"
            ? zshScript(root)
            : fishScript(root);
      // Dica no stderr (o `eval "$(...)"` captura só o stdout, então não polui).
      console.error(
        `${c.dim("# adicione ao seu rc:")} ${cmd(`eval "$(${bin} completion ${shell})"`)}`,
      );
      console.log(script);
    });
}
