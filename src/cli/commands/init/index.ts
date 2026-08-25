import { spawn } from "node:child_process";
import type { Command } from "commander";
import { brand } from "../../../brand.js";
import { renderMatrixLogo } from "../../../matrix-logo.js";
import { getProjectConfigPath, type ProjectConfig, type Ide } from "../../../config.js";
import type { Session, Ide as SessionIde, Profile } from "../../../core/session.js";
import { createSessionRepository } from "../../../adapters/pg/session-repository.js";
import { readDependencies, skillIdMap } from "../../../lib/skills.js";
import { collectRuleSkills } from "../../../lib/rules.js";
import { offerDependencyInstall, offerRuleSkills } from "../../flows/dependencies.js";
import { offerShellCompletion } from "../../flows/completion.js";
import { ensureCoreClients } from "../../flows/clients.js";
import { section, c, sym } from "../../../lib/colors.js";
import { startSpinner } from "../../../spinner.js";
import { isBinaryInstalled } from "../../../lib/client-install.js";
import { SyncReport, renderReport, browseReport, resolveReportMode } from "../../ui/report.js";
import { flushTelemetry } from "../../../lib/telemetry.js";
import { requireLocalSessionStep } from "./auth-step.js";
import { pickProfile, pickSessionName, pickIde } from "./profile-step.js";
import { confirmOverwriteIfExists, persistConfigStep, writeHarnessStep } from "./context-step.js";
import {
  promptClientChoices,
  installClients,
  resolveChosenClientIds,
  ensureChosenClientsInstalled,
} from "./clients-step.js";
import {
  resolveProvisionTargets,
  fetchSkillsStep,
  provisionTargetsStep,
  provisionHooksStep,
} from "./provision-step.js";
import { promptSelection } from "../../flows/sections.js";
import type { StoredSession } from "../../../lib/session-store.js";

/** `Session.ide` não distingue Xcode — cai em `other` como qualquer editor não-VS Code. */
function toSessionIde(ide: Ide | undefined): SessionIde {
  return ide === "vscode" ? "vscode" : "other";
}

/**
 * Escolhas do wizard (perfil, nome, seleção role/stack, IDE) + criação da
 * `Session` v2 (primeiro consumidor real do `SessionRepository`) + persistência
 * do binding (`nio.json` com `session_id`) e do harness.
 */
async function resolveSessionSetup(
  local: StoredSession,
): Promise<{ config: ProjectConfig; session: Session }> {
  const profile: Profile = await pickProfile();
  const sessionName = await pickSessionName();

  const config: ProjectConfig = {};
  config.selection = await promptSelection();
  config.ide = await pickIde();

  const sessionRepo = createSessionRepository();
  const spinner = startSpinner("Criando sessão...");
  let session: Session;
  try {
    session = await sessionRepo.create({
      userId: local.userId,
      name: sessionName,
      profile,
      projectPath: process.cwd(),
      ide: toSessionIde(config.ide),
    });
    spinner.stop();
  } catch (err) {
    spinner.fail(`Falha ao criar a sessão: ${(err as Error).message}`);
    process.exit(1);
  }

  config.session_id = session.id;
  persistConfigStep(config, session.name);
  writeHarnessStep(config, "");

  return { config, session };
}

/** Escolha e instalação dos clientes de IA + provisionamento de skills/commands/hooks. */
async function installAndProvisionClients(config: ProjectConfig): Promise<void> {
  const clientConfigs = await promptClientChoices();
  installClients(clientConfigs, process.cwd());

  const chosenClientIds = resolveChosenClientIds(clientConfigs);
  await ensureChosenClientsInstalled(chosenClientIds);

  const provisionTargets = resolveProvisionTargets(clientConfigs);

  section("Skills & commands", "provisionando pros clientes");
  const report = new SyncReport();
  await fetchSkillsStep(report);
  provisionTargetsStep(provisionTargets, config, skillIdMap(), report);
  provisionHooksStep(provisionTargets, config, report);

  const mode = resolveReportMode({});
  renderReport(report, mode);
  if (mode === "summary") await browseReport(report);
}

/** Ofertas finais: libs externas da seleção, skills recomendadas, autocomplete do shell. */
async function offerFollowUps(config: ProjectConfig): Promise<void> {
  await offerDependencyInstall(readDependencies(config.selection), { interactive: true });
  await offerRuleSkills(
    collectRuleSkills(config.selection ?? { roles: [], stacks: {} }),
    { interactive: true },
  );
  await offerShellCompletion({ interactive: true, announceConfigured: true });
  await flushTelemetry();
}

/**
 * Handoff final: entrega o ambiente materializado pro operador de IA fixo
 * (OpenCode — decisão de 2026-07-27). Se o binário não estiver no PATH (usuário
 * recusou a instalação lá em `ensureCoreClients`), só orienta em vez de falhar.
 */
async function handoffToOperator(): Promise<void> {
  console.log("");
  section("Handoff", "entregando a sessão pro OpenCode");
  if (!isBinaryInstalled("opencode")) {
    console.log(
      `  ${c.yellow(sym.warn)} OpenCode não encontrado no PATH. Instale e rode \`opencode\` ` +
        "nesta pasta pra continuar.",
    );
    return;
  }
  await new Promise<void>((resolve) => {
    const child = spawn("opencode", [], { stdio: "inherit" });
    child.on("exit", () => resolve());
    child.on("error", (err) => {
      console.error(`[erro] Falha ao iniciar o OpenCode: ${err.message}`);
      resolve();
    });
  });
}

async function runInitWizard(): Promise<void> {
  const configPath = getProjectConfigPath();
  if (!(await confirmOverwriteIfExists(configPath))) return;

  console.log(renderMatrixLogo());
  console.log(`${brand.name} init — monta o ambiente desta sessão.`);

  // Logo no início: confere OpenCode e oferece instalar se faltar.
  await ensureCoreClients({ interactive: true });

  // Sem login inline: exige `nio register`/`nio login` prévios e sai se faltar.
  const local = await requireLocalSessionStep();

  const { config } = await resolveSessionSetup(local);
  await installAndProvisionClients(config);
  await offerFollowUps(config);
  await handoffToOperator();
}

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description(`Cria ${brand.projectConfigFile} no diretório atual e materializa o ambiente da sessão`)
    .action(runInitWizard);
}
