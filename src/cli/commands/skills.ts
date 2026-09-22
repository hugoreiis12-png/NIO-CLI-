import type { Command } from "commander";
import { brand } from "../../brand.js";
import { readSkillDocs } from "../../lib/skills/skills.js";

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

  skills
    .command("pull")
    .alias("sync")
    .description("Baixa/atualiza o cache do repo de skills (força o fetch do zipball)")
    .action(async () => {
      // Lazy: `skills-cache` puxa `adm-zip` — pesado, fora do caminho quente do CLI.
      const { fetchSkills } = await import("../../lib/skills/skills-cache.js");
      const res = await fetchSkills({ force: true });
      if (res.status === "failed") {
        console.error(`[erro] falha ao baixar skills (${res.ref}): ${res.error}`);
        process.exit(1);
      }
      const label = res.status === "fetched" ? "atualizado" : "cache mantido";
      const warn = res.error ? ` (aviso: ${res.error})` : "";
      console.log(`Skills: ${label} (${res.ref}) → ${res.dir}${warn}`);
    });
}
