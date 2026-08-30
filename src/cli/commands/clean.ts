/** Limpezo e remove os artefatos legados que versões antigas do nio  */
import type { Command } from "commander";
import { rmSync, lstatSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { confirm } from "../../lib/prompts.js";
import { readSkillDocs } from "../../lib/skills/skills.js";
import { c, sym } from "../../lib/colors.js";

/**
 * Comando de limpeza: remove artefatos **legados** que versões antigas do nio
 * instalaram e que hoje foram substituídos — commands que viraram skills, ou
 * commands removidos de vez. Roda em `~/.claude` (Claude Code) e `~/.codex` (Codex).
 */

// Removidos de vez (não existem mais em nenhum formato).
const FULLY_REMOVED = [
  "new-spec",
  "new-bug",
  "new-adr",
  "apply-spec",
  "apply-bug",
  "to-skill",
];

// Eram commands e viraram skills — só o **command** legado deve sair (a skill atual fica).
const COMMAND_TO_SKILL = ["init-sdd", "to-tickets"];

interface LegacyTarget {
  path: string;
  kind: string;
}

/** Existe no disco (inclui symlink pendurado, que `existsSync` não pega)? */
function present(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Ids atualmente válidos no bundle — guarda pra nunca remover algo em uso. */
function currentIds(): { skills: Set<string>; commands: Set<string> } {
  try {
    const docs = readSkillDocs();
    return {
      skills: new Set(docs.filter((d) => d.type === "skill").map((d) => d.id)),
      commands: new Set(docs.filter((d) => d.type === "command").map((d) => d.id)),
    };
  } catch {
    return { skills: new Set(), commands: new Set() };
  }
}

function collectLegacy(): LegacyTarget[] {
  const cur = currentIds();
  const out: LegacyTarget[] = [];
  const add = (path: string, kind: string) => {
    if (present(path)) out.push({ path, kind });
  };

  const claude = join(homedir(), ".claude");
  const codex = join(homedir(), ".codex");

  // Claude Code — commands legados (nenhum desses é command atual).
  for (const id of [...FULLY_REMOVED, ...COMMAND_TO_SKILL]) {
    if (!cur.commands.has(id)) add(join(claude, "commands", `${id}.md`), "claude command");
  }
  // Claude Code — skills só dos removidos de vez (init-sdd/to-tickets são skills atuais).
  for (const id of FULLY_REMOVED) {
    if (!cur.skills.has(id)) add(join(claude, "skills", id), "claude skill");
  }

  // Codex — dual-write dos removidos de vez (prompt + skill traduzida).
  for (const id of FULLY_REMOVED) {
    if (!cur.commands.has(id) && !cur.skills.has(id)) {
      add(join(codex, "prompts", `${id}.md`), "codex prompt");
      add(join(codex, "skills", id), "codex skill");
    }
  }

  return out;
}

export function registerCleanCommand(program: Command): void {
  program
    .command("clean-legacy")
    .description(
      "Remove commands/skills legados (substituídos) de ~/.claude e ~/.codex",
    )
    .option("--dry-run", "só lista o que seria removido, sem apagar")
    .option("-y, --yes", "remove sem pedir confirmação")
    .action(async (opts: { dryRun?: boolean; yes?: boolean }) => {
      const targets = collectLegacy();

      if (targets.length === 0) {
        console.log("");
        console.log(`  ${c.green(sym.ok)} nada legado encontrado — já está limpo.`);
        return;
      }

      console.log("");
      console.log(`  ${c.bold("Artefatos legados encontrados:")}`);
      for (const t of targets) {
        console.log(`    ${c.red("-")} ${t.path} ${c.dim(`(${t.kind})`)}`);
      }

      if (opts.dryRun) {
        console.log("");
        console.log(`  ${c.dim("[dry-run] nada removido.")}`);
        return;
      }

      const ok =
        opts.yes === true ||
        (await confirm({
          message: `Remover ${targets.length} item(ns) legado(s)?`,
          default: false,
        }));
      if (!ok) {
        console.log(`  ${c.dim("cancelado.")}`);
        return;
      }

      let removed = 0;
      for (const t of targets) {
        try {
          rmSync(t.path, { recursive: true, force: true });
          removed++;
        } catch (err) {
          console.error(
            `  ${c.red(sym.err)} falha ao remover ${t.path}: ${(err as Error).message}`,
          );
        }
      }
      console.log("");
      console.log(
        `  ${c.green(sym.ok)} ${removed} removido(s). Reinicie os clientes pra refletir.`,
      );
    });
}
