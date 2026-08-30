import { existsSync } from "node:fs";
import { confirm } from "../../../lib/prompts.js";
import { c } from "../../../lib/colors.js";
import {
  writeProjectConfig,
  writeUserConfig,
  fixGitignoreForSplit,
  USER_CONFIG_FILE,
  type ProjectConfig,
} from "../../../config.js";
import { brand } from "../../../brand.js";
import { concatenateRules } from "../../../lib/skills/rules.js";
import { writeRepoHarness } from "../../../lib/clients/harness.js";
import { printHarnessResult } from "../../ui/render.js";
import { initCopy } from "../../copy.js";

/** Se já existe nio.json, confirma a sobrescrita. `true` = segue com o wizard. */
export async function confirmOverwriteIfExists(configPath: string): Promise<boolean> {
  if (!existsSync(configPath)) return true;
  const overwrite = await confirm({ message: initCopy.overwrite, default: false });
  if (!overwrite) console.log("Operação cancelada.");
  return overwrite;
}

/**
 * Grava a config: `nio.json` (repo, versionado — binding + seleção) + `nio.user.json`
 * (usuário, gitignored — ide). Ajusta o `.gitignore` (ignora só o user file). Best-effort.
 */
export function persistConfigStep(config: ProjectConfig, projectName?: string): void {
  writeProjectConfig(config);
  writeUserConfig({ ide: config.ide });
  const target = projectName
    ? ` apontando para ${projectName}`
    : " (setup local — sem projeto vinculado)";
  console.log(`[ok] Criado ${brand.projectConfigFile} (do repo)${target}.`);
  console.log(`${c.dim(`    + ${USER_CONFIG_FILE} (suas prefs, gitignored)`)}`);
  try {
    fixGitignoreForSplit();
    console.log(`${c.dim(`    + ${USER_CONFIG_FILE} adicionado ao .gitignore`)}`);
  } catch {
    /* .gitignore best-effort — não bloqueia o init */
  }
}

/** Harness no repo: rules concatenadas + AGENTS.md (overview) + CLAUDE.md. */
export function writeHarnessStep(config: ProjectConfig, overview: string): void {
  try {
    const h = writeRepoHarness(process.cwd(), {
      rulesMarkdown: concatenateRules(config.selection ?? { roles: [], stacks: {} }),
      overview,
    });
    printHarnessResult(h);
  } catch (err) {
    console.error(`[aviso] Não consegui escrever o harness: ${(err as Error).message}`);
  }
}
