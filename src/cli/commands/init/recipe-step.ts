import { select } from "../../../lib/prompts.js";
import { section } from "../../../lib/colors.js";
import type { Profile } from "../../../core/session.js";
import type { EnvironmentRecipe } from "../../../core/environment.js";
import { createRecipeCatalog } from "../../../adapters/skills/recipe-catalog.js";

/**
 * Prompt de recipe (Sprint 5.3) — presets de ambiente do repo NIO-SKILLS
 * (`recipes/<slug>.md`) que **estendem** o perfil escolhido (nunca criam perfil
 * novo). Sem recipe pro perfil (ou skills não baixadas) → devolve `null` sem
 * perguntar nada.
 */
export async function pickRecipe(profile: Profile): Promise<EnvironmentRecipe | null> {
  const recipes = createRecipeCatalog().list(profile);
  if (recipes.length === 0) return null;

  section("Recipe", "preset de ambiente do NIO-SKILLS (estende o perfil)");
  const slug = await select<string>({
    message: "Aplicar uma recipe sobre o perfil base?",
    choices: [
      { name: "Nenhuma — só o perfil base", value: "" },
      ...recipes.map((r) => ({ name: r.title, value: r.slug, description: r.description })),
    ],
  });

  return slug ? (recipes.find((r) => r.slug === slug) ?? null) : null;
}
