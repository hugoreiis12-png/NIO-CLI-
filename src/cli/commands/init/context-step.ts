import { existsSync } from "node:fs";
import { confirm } from "../../../lib/prompts.js";
import { c } from "../../../lib/colors.js";
import { startSpinner } from "../../../spinner.js";
import {
  writeProjectConfig,
  writeUserConfig,
  fixGitignoreForSplit,
  USER_CONFIG_FILE,
  type ProjectConfig,
} from "../../../config.js";
import { brand } from "../../../brand.js";
import {
  fetchProjectContext,
  buildProjectOverview,
  ProjectContextError,
} from "../../../lib/project-context.js";
import { concatenateRules } from "../../../lib/rules.js";
import { writeRepoHarness } from "../../../lib/harness.js";
import { printContextSummary, printHarnessResult } from "../../ui/render.js";
import type { DbClient } from "../../../adapters/supabase/client.js";
import type { ExchangeResult } from "../../../auth.js";
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

/**
 * Carrega o contexto do projeto (specs/ADRs/membros) e monta o overview pro
 * AGENTS.md. Falha aqui é degradada: o nio.json já foi salvo, então só avisa
 * e devolve overview vazio.
 */
export async function loadContextStep(
  supabase: DbClient,
  config: ProjectConfig,
  user: ExchangeResult["user"],
): Promise<string> {
  const contextSpinner = startSpinner("Carregando contexto do projeto...");
  try {
    const context = await fetchProjectContext(supabase, config, user);
    contextSpinner.stop();
    printContextSummary(context);
    return buildProjectOverview(context);
  } catch (err) {
    const message =
      err instanceof ProjectContextError ? err.message : (err as Error).message;
    contextSpinner.fail(`Não foi possível carregar o contexto: ${message}`);
    console.error(
      `O ${brand.projectConfigFile} foi salvo. Rode \`${brand.name} init\` de novo se precisar revincular.`,
    );
    return "";
  }
}

/** Harness no repo: rules concatenadas + AGENTS.md (overview do NOS) + CLAUDE.md. */
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
