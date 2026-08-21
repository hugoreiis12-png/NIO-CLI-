import { checkbox, select } from "../../lib/prompts.js";
import { skillsDir } from "../../lib/skills.js";
import {
  discoverRoles,
  discoverAreas,
  discoverStacks,
  DEV_ROLE,
  GENERAL,
  type Selection,
} from "../../lib/sections.js";
import { c, sym, section } from "../../lib/colors.js";

const ROLE_LABELS: Record<string, string> = { dev: "Desenvolvedor", management: "Gestão" };

/**
 * Prompt de seleção unificado: **role → áreas → stack por área**. O resultado
 * (`{ roles, stacks }`) dita skills, rules e dependencies no `init`/`sync`. O `general`
 * (do role e da área) entra sempre em cascata — não é perguntado.
 */
export async function promptSelection(): Promise<Selection> {
  console.log("");
  section("Perfil", "define quais skills, rules e deps entram");

  let roles: string[] = [];
  try {
    const available = discoverRoles(skillsDir());
    if (available.length > 0) {
      roles = await checkbox<string>({
        message: "Qual seu perfil? (espaço marca, enter confirma)",
        choices: available.map((r) => ({
          name: ROLE_LABELS[r] ?? r,
          value: r,
          description: `Instala os conjuntos de ${r}.`,
        })),
        all: true,
      });
    }
  } catch {
    /* @nio-cli/skills ausente — sem roles pra listar */
  }

  const stacks: Record<string, string> = {};
  if (roles.includes(DEV_ROLE)) {
    let areas: string[] = [];
    try {
      areas = discoverAreas(skillsDir(), DEV_ROLE);
    } catch {
      /* ignore */
    }
    if (areas.length > 0) {
      const chosen = await checkbox<string>({
        message:
          "Quais áreas de dev? Pra cada uma você escolhe a stack. O `general` (agnóstico) entra sempre.",
        choices: areas.map((a) => ({ name: a, value: a })),
        all: true,
      });
      for (const area of chosen) {
        let ss: string[] = [];
        try {
          ss = discoverStacks(skillsDir(), DEV_ROLE, area);
        } catch {
          /* ignore */
        }
        if (ss.length === 0) {
          stacks[area] = GENERAL;
          console.log(`  ${c.magenta(sym.dot)} ${area}: ${c.dim("só general (sem stacks)")}`);
          continue;
        }
        stacks[area] = await select<string>({
          message: `Stack de ${area}?`,
          choices: [
            { name: `${GENERAL} — só o baseline da área`, value: GENERAL },
            ...ss.map((s) => ({ name: s, value: s })),
          ],
        });
      }
    }
  }

  const summary: string[] = [];
  for (const r of roles) {
    if (r === DEV_ROLE && Object.keys(stacks).length > 0) {
      const areas = Object.entries(stacks)
        .map(([a, s]) => `${a}:${s}`)
        .join(", ");
      summary.push(`dev(${areas})`);
    } else {
      summary.push(ROLE_LABELS[r] ?? r);
    }
  }
  console.log(
    `  ${c.magenta(sym.dot)} ${summary.length ? summary.join(" · ") : c.dim("nada selecionado")}`,
  );

  return { roles, stacks };
}
