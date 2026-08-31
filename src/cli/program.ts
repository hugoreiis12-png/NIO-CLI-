/**
 * Constrói a árvore de comandos do `nio` (commander). Separado do `cli.ts` (o
 * bootstrap) pra que a TUI (`src/tui/`) e o `nio docs` possam enumerar os
 * comandos sem puxar a lógica de parse/argv.
 */
import { Command } from "commander";
import { VERSION } from "../version.js";
import { brand } from "../brand.js";
import { renderMatrixLogo } from "../matrix-logo.js";
import { registerAuthCommands } from "./commands/auth.js";
import { registerInitCommand } from "./commands/init/index.js";
import { registerSyncCommand } from "./commands/sync.js";
import { registerSkillsCommands } from "./commands/skills.js";
import { registerCleanCommand } from "./commands/clean.js";
import { registerExecCommand } from "./commands/exec.js";
import { registerPlanCommand } from "./commands/plan.js";
import { registerValidatePlanCommand } from "./commands/validate-plan.js";
import { registerCompletionCommand } from "./commands/completion.js";
import { registerLangCommand } from "./commands/lang.js";
import { registerSessionsCommand } from "./commands/sessions.js";
import { registerDebugCommand } from "./commands/debug.js";
import { registerAgentsCommand } from "./commands/agents.js";
import { registerCommandCommand } from "./commands/command.js";
import { registerOpenCommand } from "./commands/open.js";
import { registerDepsCommand } from "./commands/deps.js";
import { registerDockerCommand } from "./commands/docker.js";
import { registerSecurityCommands } from "./commands/security.js";
import { registerDocsCommand } from "./commands/docs.js";
import { registerConfigCommand } from "./commands/config.js";
import { registerStartCommand } from "./commands/start.js";
import { registerAiCommand } from "./commands/ai.js";

/** `logoShown` fica em `cli.ts` — aqui só o hook do help. */
export function buildProgram(logoShown: () => boolean = () => false): Command {
  const program = new Command();
  program
    .name(brand.name)
    .description(`CLI do ${brand.productName} (${brand.productFullName}) — rode \`nio\` sem argumentos pra esteira guiada`)
    .version(VERSION)
    .addHelpText("beforeAll", () => (logoShown() ? "" : renderMatrixLogo()));

  registerAuthCommands(program);
  registerInitCommand(program);
  registerSyncCommand(program);
  registerSkillsCommands(program);
  registerCleanCommand(program);
  registerExecCommand(program);
  registerPlanCommand(program);
  registerValidatePlanCommand(program);
  registerCompletionCommand(program);
  registerLangCommand(program);
  registerSessionsCommand(program);
  registerDebugCommand(program);
  registerAgentsCommand(program);
  registerCommandCommand(program);
  registerOpenCommand(program);
  registerDepsCommand(program);
  registerDockerCommand(program);
  registerSecurityCommands(program);
  registerDocsCommand(program);
  registerConfigCommand(program);
  registerStartCommand(program);
  registerAiCommand(program);

  return program;
}
