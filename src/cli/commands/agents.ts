import type { Command } from "commander";
import { readSkillDocs } from "../../lib/skills/skills.js";
import { section, c, sym } from "../../lib/colors.js";
import { brand } from "../../brand.js";

/**
 * `nio agents` — lista os agentes disponíveis (docs `agent` do pacote de skills,
 * `~/.nio/skills/agents/`). Só leitura; mesma fonte que o `init` provisiona.
 */
export function registerAgentsCommand(program: Command): void {
  program
    .command("agents")
    .description("Lista os agentes disponíveis")
    .action(() => {
      let agents;
      try {
        agents = readSkillDocs().filter((d) => d.type === "agent");
      } catch (err) {
        console.error(`${c.yellow(sym.warn)} Não consegui ler os agentes: ${(err as Error).message}`);
        console.error(`      ${c.dim(`Rode \`${brand.name} sync\` pra baixar o cache de skills.`)}`);
        process.exitCode = 1;
        return;
      }

      if (agents.length === 0) {
        console.log(`Nenhum agente disponível. Rode ${c.cyan(`${brand.name} sync`)} pra atualizar o cache.`);
        return;
      }

      section("Agentes", `${agents.length} disponíveis`);
      const width = Math.max(...agents.map((a) => a.id.length));
      for (const a of agents.sort((x, y) => x.id.localeCompare(y.id))) {
        console.log(`  ${c.bold(a.id.padEnd(width))}  ${c.dim(a.description || "(sem descrição)")}`);
      }
    });
}
