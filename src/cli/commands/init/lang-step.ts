// Prompts do wizard de pré-configuração de linguagens (nio-lang / fullstack).
import type { LanguageId, LanguageRecipe, ScaffoldChoices } from "../../../core/lang.js";
import { LANGUAGE_IDS } from "../../../core/lang.js";
import { select, checkbox } from "../../../lib/prompts.js";
import { section } from "../../../lib/colors.js";

const LANG_LABELS: Record<LanguageId, string> = {
  python: "Python",
  typescript: "TypeScript",
  node: "Node.js",
  csharp: "C#",
  n8n: "n8n",
};

/** Quais linguagens pré-configurar (multi-select). Vazio = não configura nada. */
export async function pickLanguages(): Promise<LanguageId[]> {
  section("Linguagens", "quais pré-configurar no ambiente");
  return checkbox<LanguageId>({
    message: "Selecione as linguagens pra pré-configurar (espaço marca, enter confirma):",
    choices: LANGUAGE_IDS.map((id) => ({ name: LANG_LABELS[id], value: id })),
  });
}

const NONE = "(nenhum)";

/** Package manager / framework / ORM de uma linguagem (a partir da recipe). */
export async function pickLanguageChoices(recipe: LanguageRecipe): Promise<ScaffoldChoices> {
  const packageManager = await select<string>({
    message: `[${recipe.language}] Package manager?`,
    choices: recipe.packageManagers.map((pm) => ({ name: pm, value: pm })),
  });

  const framework = await select<string | undefined>({
    message: `[${recipe.language}] Framework?`,
    choices: [
      { name: NONE, value: undefined },
      ...recipe.frameworks.map((f) => ({ name: f, value: f })),
    ],
  });

  // Espelha o framework: "(nenhum)" + os ORMs da recipe (n8n tem lista vazia → só "(nenhum)").
  const orm = await select<string | undefined>({
    message: `[${recipe.language}] ORM?`,
    choices: [
      { name: NONE, value: undefined },
      ...recipe.orms.map((o) => ({ name: o, value: o })),
    ],
  });

  return { packageManager, framework, orm };
}
