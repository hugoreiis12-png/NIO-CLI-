import { spawn } from "node:child_process";
import type { Command } from "commander";
import { brand } from "../../../brand.js";
import { renderMatrixLogo } from "../../../matrix-logo.js";
import { getProjectConfigPath, type ProjectConfig, type Ide } from "../../../config.js";
import type { Session, Ide as SessionIde, Profile } from "../../../core/session.js";
import { createSessionRepository } from "../../../adapters/pg/session-repository.js";
import { EnvironmentBuilder } from "../../../app/environment-builder.js";
import type { McpSpec } from "../../../core/environment.js";
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
import { writeManagedDotfiles } from "../../../lib/dotfiles.js";
import { confirm } from "../../../lib/prompts.js";
import { LanguageConfigurator, type LanguageSelection } from "../../../app/language-configurator.js";
import { createLanguageCatalog } from "../../../adapters/lang/language-catalog.js";
import { n8nMcp } from "../../../profiles/mcps.js";
import type { LanguageId } from "../../../core/lang.js";
import type { EnvironmentConfig } from "../../../core/session.js";
import { pickLanguages, pickLanguageChoices } from "./lang-step.js";
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
 * Pré-configuração de linguagens (só fullstack): wizard de escolha →
 * `LanguageConfigurator`, que mostra o **preview (dry-run)** e só instala de
 * verdade após confirmação. Nunca aplica sem o gate. Best-effort — falha de uma
 * linguagem não derruba o init.
 */
async function preConfigureLanguages(): Promise<LanguageId[]> {
  const languages = await pickLanguages();
  if (languages.length === 0) return [];

  const catalog = createLanguageCatalog();
  const selections: LanguageSelection[] = [];
  for (const language of languages) {
    const choices = await pickLanguageChoices(catalog.recipe(language));
    selections.push({ language, choices });
  }

  const confirmFn = async (language: string, preview: string[]): Promise<boolean> => {
    console.log("");
    section("Preview", `${language} — o que será feito (nada roda ainda)`);
    for (const line of preview) console.log(`  ${c.dim(sym.arrow)} ${line}`);
    return confirm({ message: `Aplicar no projeto (${process.cwd()})?`, default: false });
  };

  const results = await new LanguageConfigurator().configure(selections, process.cwd(), confirmFn);
  for (const r of results) {
    if (!r.applied) {
      console.log(`  ${c.dim(sym.bullet)} ${r.language}: pulado (não confirmado)`);
      continue;
    }
    const failed = r.steps.filter((s) => s.status === "failed");
    const icon = failed.length > 0 ? c.yellow(sym.warn) : c.green(sym.ok);
    const suffix = failed.length > 0 ? ` (${failed.length} passo(s) falharam)` : "";
    console.log(`  ${icon} ${r.language}: configurado${suffix}`);
  }

  return languages;
}

/**
 * Escolhas do wizard (perfil, nome, seleção role/stack, IDE) + criação da
 * `Session` v2 (primeiro consumidor real do `SessionRepository`) + persistência
 * do binding (`nio.json` com `session_id`) e do harness.
 */
async function resolveSessionSetup(
  local: StoredSession,
): Promise<{ config: ProjectConfig; session: Session; mcps: McpSpec[] }> {
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

  // Materializa o ambiente do perfil (EnvironmentBuilder). Falha parcial não
  // aborta: a sessão já existe e o ambiente é incremental — perfil ainda sem
  // definição no catálogo só avisa e segue sem MCPs de perfil.
  let mcps: McpSpec[] = [];
  let envConfig: EnvironmentConfig | undefined;
  try {
    const env = await new EnvironmentBuilder().build(profile);
    envConfig = env.config;
    await sessionRepo.updateConfig(session.id, env.config);
    mcps = env.mcps;
    for (const t of env.toolchains) {
      if (t.status === "failed") {
        console.warn(`${c.yellow(sym.warn)} Toolchain "${t.id}" não materializado: ${t.error}`);
      }
    }

    // envVars/aliases → ~/.nio/profile.{sh,ps1} (best-effort; não aborta a sessão).
    try {
      const dot = writeManagedDotfiles({ envVars: env.config.envVars, aliases: env.config.aliases });
      if (dot.some((d) => d.status === "written")) {
        for (const d of dot) console.log(`  ${c.dim(`+ ${d.path}`)}`);
        console.log(
          `  ${c.dim("dê `source ~/.nio/profile.sh` (ou . ~/.nio/profile.ps1 no PowerShell) pra ativar envVars/aliases")}`,
        );
      }
    } catch (e) {
      console.warn(`${c.yellow(sym.warn)} dotfiles do perfil não escritos: ${(e as Error).message}`);
    }
  } catch (err) {
    console.warn(
      `${c.yellow(sym.warn)} Ambiente do perfil "${profile}" não materializado: ${(err as Error).message}`,
    );
  }

  // Pré-configuração de linguagens — só no perfil fullstack (com preview+confirm).
  if (profile === "fullstack") {
    const selected = await preConfigureLanguages();
    // n8n escolhido → registra o n8n-mcp como MCP próprio (docs de nodes/workflows).
    if (selected.includes("n8n") && !mcps.some((m) => m.id === n8nMcp.id)) {
      mcps = [...mcps, n8nMcp];
      if (envConfig) {
        const cfgMcps = Array.from(new Set([...(envConfig.mcps ?? []), n8nMcp.id]));
        await sessionRepo.updateConfig(session.id, { ...envConfig, mcps: cfgMcps });
      }
      console.log(`  ${c.green(sym.ok)} n8n-mcp registrado (docs de nodes/workflows do n8n).`);
    }
  }

  persistConfigStep(config, session.name);
  writeHarnessStep(config, "");

  return { config, session, mcps };
}

/** Escolha e instalação dos clientes de IA + provisionamento de skills/commands/hooks. */
async function installAndProvisionClients(
  config: ProjectConfig,
  profileMcps: McpSpec[],
): Promise<void> {
  const clientConfigs = await promptClientChoices();
  installClients(clientConfigs, process.cwd(), profileMcps);

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

  const { config, mcps } = await resolveSessionSetup(local);
  await installAndProvisionClients(config, mcps);
  await offerFollowUps(config);
  await handoffToOperator();
}

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description(`Cria ${brand.projectConfigFile} no diretório atual e materializa o ambiente da sessão`)
    .action(runInitWizard);
}
