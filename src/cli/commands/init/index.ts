import { spawn } from "node:child_process";
import type { Command } from "commander";
import { brand } from "../../../brand.js";
import { renderMatrixLogo } from "../../../matrix-logo.js";
import { getProjectConfigPath, type ProjectConfig, type Ide } from "../../../config.js";
import type { Session, Ide as SessionIde, Profile } from "../../../core/session.js";
import { SessionManager, type MaterializedSession } from "../../../app/session-manager.js";
import type { McpSpec } from "../../../core/environment.js";
import { createIdeGateway } from "../../../adapters/ide/ide-gateway.js";
import { readDependencies, skillIdMap } from "../../../lib/skills.js";
import { collectRuleSkills } from "../../../lib/rules.js";
import { offerDependencyInstall, offerRuleSkills } from "../../flows/dependencies.js";
import { offerShellCompletion } from "../../flows/completion.js";
import { ensureCoreClients } from "../../flows/clients.js";
import { ensureConfig } from "../../../lib/nio-config.js";
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
import { pickRecipe } from "./recipe-step.js";
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

/**
 * Mapeia o `Ide` do wizard (`config.Ide`, superset) pro `Session.ide` (domínio).
 * `xcode` não existe no `Session.ide` (é só integração do /implement) → `other`;
 * o resto passa direto (todos são valores válidos do union do domínio).
 */
function toSessionIde(ide: Ide | undefined): SessionIde {
  switch (ide) {
    case "vscode":
      return "vscode";
    case "cursor":
      return "cursor";
    case "terminal":
      return "terminal";
    default:
      return "other"; // xcode | other | undefined
  }
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
  const recipe = await pickRecipe(profile);
  const sessionName = await pickSessionName();

  const config: ProjectConfig = {};
  config.selection = await promptSelection();
  config.ide = await pickIde();

  const manager = new SessionManager();
  const spinner = startSpinner("Criando sessão...");
  let built: MaterializedSession;
  try {
    built = await manager.create({
      userId: local.userId,
      name: sessionName,
      profile,
      projectPath: process.cwd(),
      ide: toSessionIde(config.ide),
      recipe: recipe ?? undefined,
    });
    spinner.stop();
  } catch (err) {
    spinner.fail(`Falha ao criar a sessão: ${(err as Error).message}`);
    process.exit(1);
  }

  const session = built.session;
  config.session_id = session.id;

  // Materialização do ambiente (EnvironmentBuilder, via SessionManager). Falha
  // parcial não aborta: a sessão já existe e o ambiente é incremental.
  let mcps: McpSpec[] = built.mcps;
  let envConfig: EnvironmentConfig | undefined;
  if (built.materializeError) {
    console.warn(
      `${c.yellow(sym.warn)} Ambiente do perfil "${profile}" não materializado: ${built.materializeError}`,
    );
  } else {
    envConfig = built.config;
    if (recipe) console.log(`  ${c.dim(`recipe: ${recipe.title}`)}`);
    for (const w of built.recipeWarnings) {
      console.warn(`${c.yellow(sym.warn)} recipe: ${w} não existe no catálogo — ignorado.`);
    }
    for (const t of built.toolchains) {
      if (t.status === "failed") {
        console.warn(`${c.yellow(sym.warn)} Toolchain "${t.id}" não materializado: ${t.error}`);
      }
    }

    // envVars/aliases → ~/.nio/profile.{sh,ps1} (best-effort; não aborta a sessão).
    try {
      const dot = writeManagedDotfiles({ envVars: built.config.envVars, aliases: built.config.aliases });
      if (dot.some((d) => d.status === "written")) {
        for (const d of dot) console.log(`  ${c.dim(`+ ${d.path}`)}`);
        console.log(
          `  ${c.dim("dê `source ~/.nio/profile.sh` (ou . ~/.nio/profile.ps1 no PowerShell) pra ativar envVars/aliases")}`,
        );
      }
    } catch (e) {
      console.warn(`${c.yellow(sym.warn)} dotfiles do perfil não escritos: ${(e as Error).message}`);
    }
  }

  // Pré-configuração de linguagens — só no perfil fullstack (com preview+confirm).
  if (profile === "fullstack") {
    const selected = await preConfigureLanguages();
    // n8n escolhido → registra o n8n-mcp como MCP próprio (docs de nodes/workflows).
    if (selected.includes("n8n") && !mcps.some((m) => m.id === n8nMcp.id)) {
      mcps = [...mcps, n8nMcp];
      if (envConfig) {
        const cfgMcps = Array.from(new Set([...(envConfig.mcps ?? []), n8nMcp.id]));
        await manager.updateConfig(session.id, { ...envConfig, mcps: cfgMcps });
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
 * Abre a IDE da sessão na pasta do projeto (parte da materialização — Sprint 2.2).
 * Best-effort: `skipped` é silencioso (terminal/other), o resto só avisa — nunca
 * aborta o init (a sessão já existe e o ambiente está materializado).
 */
async function openSessionIde(session: Session): Promise<void> {
  const result = await createIdeGateway().open(session.ide, session.projectPath);
  switch (result.status) {
    case "opened":
      console.log(`  ${c.green(sym.ok)} Abrindo ${c.bold(result.binary ?? "")} em ${c.dim(session.projectPath)}`);
      break;
    case "unavailable":
      console.log(`  ${c.yellow(sym.warn)} IDE não aberta: ${result.error}`);
      break;
    case "failed":
      console.log(`  ${c.yellow(sym.warn)} Falha ao abrir a IDE: ${result.error}`);
      break;
    case "skipped":
      break; // sem editor pra abrir — segue direto pro handoff.
  }
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

  // Antes de tudo: config da equipe (NIO_DATABASE_URL/JWT_SECRET). Falta → wizard.
  await ensureConfig({ interactive: true });

  // Confere OpenCode e oferece instalar se faltar.
  await ensureCoreClients({ interactive: true });

  // Sem login inline: exige `nio register`/`nio login` prévios e sai se faltar.
  const local = await requireLocalSessionStep();

  const { config, session, mcps } = await resolveSessionSetup(local);
  await installAndProvisionClients(config, mcps);
  await offerFollowUps(config);
  await openSessionIde(session);
  await handoffToOperator();
}

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description(`Cria ${brand.projectConfigFile} no diretório atual e materializa o ambiente da sessão`)
    .action(runInitWizard);
}
