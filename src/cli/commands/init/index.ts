import type { Command } from "commander";
import { brand } from "../../../brand.js";
import { getProjectConfigPath, type ProjectConfig } from "../../../config.js";
import { readDependencies, skillIdMap } from "../../../lib/skills.js";
import { collectRuleSkills } from "../../../lib/rules.js";
import { offerDependencyInstall, offerRuleSkills } from "../../flows/dependencies.js";
import { offerShellCompletion } from "../../flows/completion.js";
import { ensureCoreClients } from "../../flows/clients.js";
import { section } from "../../../lib/colors.js";
import { SyncReport, renderReport, browseReport, resolveReportMode } from "../../ui/report.js";
import { flushTelemetry } from "../../../lib/telemetry.js";
import type { AuthenticatedSession } from "../../../adapters/supabase/client.js";
import { hasCredentials, createSessionStep } from "./auth-step.js";
import {
  fetchMemberProjectsStep,
  pickProject,
  pickRepository,
  buildBaseConfig,
  pickIde,
} from "./project-step.js";
import { confirmOverwriteIfExists, persistConfigStep, loadContextStep, writeHarnessStep } from "./context-step.js";
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

/** Fluxo autenticado: projeto/repositório do NOS + contexto, além de seleção/IDE/harness. */
async function resolveProjectSetup(): Promise<{
  config: ProjectConfig;
  session: AuthenticatedSession;
}> {
  const session = await createSessionStep();
  const { supabase } = session;

  const projects = await fetchMemberProjectsStep(supabase, session.user.id);
  const selectedProject = await pickProject(projects);
  const repositoryId = await pickRepository(supabase, selectedProject.id);
  const config = buildBaseConfig(selectedProject.id, repositoryId);

  config.selection = await promptSelection();
  config.ide = await pickIde();

  persistConfigStep(config, selectedProject.name);
  const overview = await loadContextStep(supabase, config, session.user);
  writeHarnessStep(config, overview);

  return { config, session };
}

/**
 * Fluxo local (sem credenciais): pula projeto/contexto do NOS — que exigem
 * sessão — e configura só o que é local: seleção role/stack, IDE, `nio.json`
 * sem binding e o harness com as rules. É o caminho padrão enquanto a auth
 * está pausada; `nio login` + `nio init` de novo faz o vínculo depois.
 */
async function resolveLocalSetup(): Promise<{
  config: ProjectConfig;
  session: null;
}> {
  section("Setup local", "sem autenticação — projeto do NOS fica pra depois");
  console.log(
    "Você ainda não está autenticado, então vou configurar só o que é local " +
      `(clientes, skills, seleção e IDE). Rode \`${brand.name} login\` e \`${brand.name} init\` ` +
      "de novo quando quiser vincular um projeto do NOS.",
  );

  const config: ProjectConfig = {};
  config.selection = await promptSelection();
  config.ide = await pickIde();

  persistConfigStep(config);
  writeHarnessStep(config, "");

  return { config, session: null };
}

/** Escolha e instalação dos clientes de IA + provisionamento de skills/commands/hooks. */
async function installAndProvisionClients(
  config: ProjectConfig,
  session: AuthenticatedSession | null,
): Promise<void> {
  const clientConfigs = await promptClientChoices();
  installClients(clientConfigs, process.cwd());

  const chosenClientIds = resolveChosenClientIds(clientConfigs);
  await ensureChosenClientsInstalled(chosenClientIds);

  const provisionTargets = resolveProvisionTargets(clientConfigs);

  section("Skills & commands", "provisionando pros clientes");
  const report = new SyncReport();
  await fetchSkillsStep(report);
  provisionTargetsStep(provisionTargets, config, session, skillIdMap(), report);
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

async function runInitWizard(): Promise<void> {
  const configPath = getProjectConfigPath();
  if (!(await confirmOverwriteIfExists(configPath))) return;

  // Logo no início: confere OpenCode e oferece instalar se faltar.
  await ensureCoreClients({ interactive: true });

  // Auth pausada: usa a sessão se já houver credenciais (`nio login`), senão
  // segue no setup local sem vincular projeto do NOS.
  const { config, session } = (await hasCredentials())
    ? await resolveProjectSetup()
    : await resolveLocalSetup();
  await installAndProvisionClients(config, session);
  await offerFollowUps(config);
}

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description(
      `Cria ${brand.projectConfigFile} no diretório atual vinculando a um projeto do ${brand.productName}`,
    )
    .action(runInitWizard);
}
