/**
 * Constrói a árvore de comandos do `nio` (commander). Separado do `cli.ts` (o
 * bootstrap) pra que a TUI (`src/tui/`) e o `nio docs` possam enumerar os
 * comandos sem puxar a lógica de parse/argv.
 */
import type { Command } from "commander";
import { createBaseProgram } from "./program-base.js";
import { registerLeaves } from "./program-lazy.js";
import { registerAuthCommands } from "./commands/auth.js";
import { registerInitCommand } from "./commands/init/register.js";
import { registerSyncCommand } from "./commands/sync.js";
import { registerSkillsCommands } from "./commands/skills.js";
import { registerExecCommand } from "./commands/exec.js";
import { registerPlanCommand } from "./commands/plan.js";
import { registerValidatePlanCommand } from "./commands/validate-plan.js";
import { registerCompletionCommand } from "./commands/completion.js";
import { registerLangCommand } from "./commands/lang.js";
import { registerSessionsCommand } from "./commands/sessions.js";
import { registerCommandCommand } from "./commands/command.js";
import { registerDepsCommand } from "./commands/deps.js";
import { registerDockerCommand } from "./commands/docker.js";
import { registerSecurityCommands } from "./commands/security.js";
import { registerDocsCommand } from "./commands/docs.js";
import { registerConfigCommand } from "./commands/config.js";
import { registerFabricCommand } from "./commands/fabric.js";
import { registerStartCommand } from "./commands/start.js";
import { registerAiCommand } from "./commands/ai.js";
import { registerTaskCommand } from "./commands/task.js";
import { registerN8nCommand } from "./commands/n8n.js";

/** `logoShown` fica em `cli.ts` — aqui só o hook do help. */
export function buildProgram(logoShown: () => boolean = () => false): Command {
  const program = createBaseProgram(logoShown);

  registerAuthCommands(program);
  registerInitCommand(program);
  registerSyncCommand(program);
  registerSkillsCommands(program);
  registerExecCommand(program);
  registerPlanCommand(program);
  registerValidatePlanCommand(program);
  registerCompletionCommand(program);
  registerLangCommand(program);
  registerSessionsCommand(program);
  registerLeaves(program);
  registerCommandCommand(program);
  registerDepsCommand(program);
  registerDockerCommand(program);
  registerSecurityCommands(program);
  registerDocsCommand(program);
  registerConfigCommand(program);
  registerFabricCommand(program);
  registerStartCommand(program);
  registerAiCommand(program);
  registerTaskCommand(program);
  registerN8nCommand(program);

  return program;
}
