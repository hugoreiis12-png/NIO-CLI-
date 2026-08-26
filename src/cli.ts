#!/usr/bin/env node
import { Command } from "commander";
import { VERSION } from "./version.js";
import { brand } from "./brand.js";
import { renderMatrixLogo } from "./matrix-logo.js";
import { notifyCliIfUpdate } from "./lib/version-check.js";
import { registerAuthCommands } from "./cli/commands/auth.js";
import { registerInitCommand } from "./cli/commands/init/index.js";
import { registerSyncCommand } from "./cli/commands/sync.js";
import { registerSkillsCommands } from "./cli/commands/skills.js";
import { registerCleanCommand } from "./cli/commands/clean.js";
import { registerExecCommand } from "./cli/commands/exec.js";
import { registerPlanCommand } from "./cli/commands/plan.js";
import { registerValidatePlanCommand } from "./cli/commands/validate-plan.js";
import { registerCompletionCommand } from "./cli/commands/completion.js";
import { registerLangCommand } from "./cli/commands/lang.js";
import { registerSessionsCommand } from "./cli/commands/sessions.js";
import { registerDebugCommand } from "./cli/commands/debug.js";
import { registerAgentsCommand } from "./cli/commands/agents.js";
import { registerCommandCommand } from "./cli/commands/command.js";
import { registerOpenCommand } from "./cli/commands/open.js";
import { registerDepsCommand } from "./cli/commands/deps.js";

notifyCliIfUpdate();

const program = new Command();
program
  .name(brand.name)
  .description(`CLI do ${brand.productName} (${brand.productFullName})`)
  .version(VERSION)
  .addHelpText("beforeAll", () => renderMatrixLogo());

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

program.parseAsync(process.argv).catch((err) => {
  console.error(`Erro: ${(err as Error).message}`);
  process.exit(1);
});
