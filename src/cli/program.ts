/**
 * Constrói a árvore de comandos do `nio` (commander). Separado do `cli.ts` (o
 * bootstrap) pra que a TUI (`src/tui/`) e o `nio docs` possam enumerar os
 * comandos sem puxar a lógica de parse/argv.
 */
import { Command } from "commander";
import { VERSION } from "../version.js";
import { brand } from "../brand.js";
import { renderMatrixLogo, shouldDrawLogo } from "../matrix-logo.js";
import { usageGuide } from "./help-guide.js";
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

/** `logoShown` fica em `cli.ts` — aqui só o hook do help. */
/**
 * Comandos carregados sob demanda. Nome e descrição ficam aqui — texto, custo
 * zero — e o módulo só é importado quando o comando roda. Antes, `nio --version`
 * pagava o import de todos: `program.js` custava 152 ms, 93% do cold start.
 *
 * **Só entra aqui comando sem `.option()` e sem subcomando.** O commander precisa
 * das opções declaradas antes do parse; adiar uma faria `nio x --flag` virar
 * "unknown option". Para os demais, o padrão exige registrar as opções aqui.
 */
const LAZY_COMMANDS: ReadonlyArray<{
  name: string;
  description: string;
  load: () => Promise<() => void | Promise<void>>;
}> = [
  {
    name: "debug",
    description: "Diagnostica o ambiente e aponta onde está o problema",
    load: async () => (await import("./commands/debug.js")).runDebug,
  },
  {
    name: "agents",
    description: "Lista os agentes disponíveis",
    load: async () => (await import("./commands/agents.js")).runAgents,
  },
  {
    name: "open",
    description: "Abre a IDE da sessão ativa na pasta do projeto",
    load: async () => (await import("./commands/open.js")).runOpen,
  },
];

function registerLazyCommands(program: Command): void {
  for (const { name, description, load } of LAZY_COMMANDS) {
    program
      .command(name)
      .description(description)
      .action(async () => {
        await (await load())();
      });
  }
}

export function buildProgram(logoShown: () => boolean = () => false): Command {
  const program = new Command();
  program
    .name(brand.name)
    .description(`CLI do ${brand.productName} (${brand.productFullName}) — rode \`nio\` sem argumentos pra esteira guiada`)
    .version(VERSION)
    .addHelpText("beforeAll", () => (logoShown() || !shouldDrawLogo() ? "" : renderMatrixLogo()))
    // só no help do topo (`nio --help`), não no de cada subcomando
    .addHelpText("after", (ctx) => (ctx.command.name() === brand.name ? usageGuide() : ""));

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
  registerLazyCommands(program);
  registerCommandCommand(program);
  registerDepsCommand(program);
  registerDockerCommand(program);
  registerSecurityCommands(program);
  registerDocsCommand(program);
  registerConfigCommand(program);
  registerFabricCommand(program);
  registerStartCommand(program);
  registerAiCommand(program);

  return program;
}
