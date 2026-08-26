import { existsSync } from "node:fs";
import { select } from "../../lib/prompts.js";
import {
  getUserConfigPath,
  writeUserConfig,
  migrateConfigSplit,
  fixGitignoreForSplit,
  USER_CONFIG_FILE,
  type Ide,
} from "../../config.js";
import { c, sym, section } from "../../lib/colors.js";
import { brand } from "../../brand.js";

/**
 * Garante o `nio.user.json` (prefs por-máquina, gitignored). Primeiro **migra** o
 * formato antigo monolítico (move `ide` do `nio.json` versionado pro user file, e tira
 * o `nio.json` do `.gitignore`). Se ainda não houver prefs e for TTY, **prompta** — é o
 * caso do dev que clonou um repo já configurado (o `nio.json` do time já existe) e roda
 * só `nio sync`.
 */
export async function ensureUserConfig(opts: {
  interactive: boolean;
  hasRepoConfig: boolean;
}): Promise<void> {
  if (migrateConfigSplit()) {
    fixGitignoreForSplit();
    console.log(`  ${c.dim(`migrado: ide → ${USER_CONFIG_FILE}; ${brand.projectConfigFile} versionado`)}`);
  }

  if (!opts.hasRepoConfig) return; // sem binding do repo → é caso de `nio init`
  if (existsSync(getUserConfigPath())) return; // já tem prefs
  if (!opts.interactive) return; // não-TTY → não dá pra perguntar

  section("Suas preferências", "por-máquina, não versionadas");
  const ide = await select<Ide>({
    message: "Qual IDE você usa? (habilita integrações do /implement)",
    choices: [
      { name: "VS Code", value: "vscode" },
      { name: "Cursor", value: "cursor" },
      { name: "Xcode", value: "xcode" },
      { name: "Terminal (sem editor)", value: "terminal" },
      { name: "Outra", value: "other" },
    ],
  });
  writeUserConfig({ ide });
  fixGitignoreForSplit();
  console.log(`  ${c.green(sym.ok)} ${c.dim(`salvo em ${USER_CONFIG_FILE} (gitignored)`)}`);
}
