import type { Command } from "commander";
import { brand } from "../../brand.js";
import { readSkillDocs } from "../../lib/skills.js";

export function registerSkillsCommands(program: Command): void {
  const skills = program
    .command("skills")
    .description(`Skills, commands e agents do ${brand.name} (lidos do repo aberto via cache)`);

  skills
    .command("status")
    .description(`Lista os docs do repo de skills (cache local ~/${brand.homeDirName}/skills)`)
    .action(() => {
      try {
        const docs = readSkillDocs();
        console.log(`Skills: ${docs.length} docs`);
        for (const d of docs) console.log(`  ${d.type.padEnd(10)} ${d.path}`);
      } catch (err) {
        console.error(`[erro] ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
