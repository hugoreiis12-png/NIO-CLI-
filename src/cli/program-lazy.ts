/**
 * Monta o programa carregando **só o módulo do comando invocado**.
 *
 * Medido: importar `program.ts` (com os ~20 módulos estáticos) custa 159 ms, e o
 * peso não é de comando nenhum — são as dependências compartilhadas (`pg` 31 ms,
 * `boxen` 24, `adm-zip` 13). Elas só saem do caminho quando ninguém as importa,
 * e é isso que o roteamento por argv faz: `nio --version` cai para ~42 ms e
 * `nio docker …` para ~72 ms.
 *
 * **Fallback é a blindagem principal**: nome fora do mapa → carrega todos. Um
 * erro de mapeamento degrada para o comportamento de hoje (lento), nunca para
 * "comando desconhecido".
 */
import type { Command } from "commander";
import { createBaseProgram } from "./program-base.js";

type Register = (program: Command) => void;

/**
 * Módulo → função de registro. Os **nomes de topo** de cada módulo foram
 * extraídos em runtime (registrando num `Command` vazio), não por regex: `auth`
 * cria quatro comandos e `exec` cria dois, o que um grep não mostraria.
 */
const MODULES: ReadonlyArray<{ names: readonly string[]; load: () => Promise<Register> }> = [
  {
    names: ["register", "login", "logout", "whoami"],
    load: async () => (await import("./commands/auth.js")).registerAuthCommands,
  },
  {
    names: ["init"],
    load: async () => (await import("./commands/init/register.js")).registerInitCommand,
  },
  { names: ["sync"], load: async () => (await import("./commands/sync.js")).registerSyncCommand },
  {
    names: ["skills"],
    load: async () => (await import("./commands/skills.js")).registerSkillsCommands,
  },
  {
    names: ["exec", "exec-status"],
    load: async () => (await import("./commands/exec.js")).registerExecCommand,
  },
  { names: ["plan"], load: async () => (await import("./commands/plan.js")).registerPlanCommand },
  {
    names: ["validate-plan"],
    load: async () => (await import("./commands/validate-plan.js")).registerValidatePlanCommand,
  },
  {
    names: ["completion"],
    load: async () => (await import("./commands/completion.js")).registerCompletionCommand,
  },
  { names: ["lang"], load: async () => (await import("./commands/lang.js")).registerLangCommand },
  {
    names: ["sessions"],
    load: async () => (await import("./commands/sessions.js")).registerSessionsCommand,
  },
  {
    names: ["command"],
    load: async () => (await import("./commands/command.js")).registerCommandCommand,
  },
  { names: ["deps"], load: async () => (await import("./commands/deps.js")).registerDepsCommand },
  {
    names: ["docker"],
    load: async () => (await import("./commands/docker.js")).registerDockerCommand,
  },
  {
    names: ["security"],
    load: async () => (await import("./commands/security.js")).registerSecurityCommands,
  },
  { names: ["docs"], load: async () => (await import("./commands/docs.js")).registerDocsCommand },
  {
    names: ["config"],
    load: async () => (await import("./commands/config.js")).registerConfigCommand,
  },
  {
    names: ["fabric"],
    load: async () => (await import("./commands/fabric.js")).registerFabricCommand,
  },
  {
    names: ["start"],
    load: async () => (await import("./commands/start.js")).registerStartCommand,
  },
  { names: ["ai"], load: async () => (await import("./commands/ai.js")).registerAiCommand },
  { names: ["task"], load: async () => (await import("./commands/task.js")).registerTaskCommand },
];

/** Comandos-folha: nome e descrição aqui, módulo só quando executa. */
const LEAVES: ReadonlyArray<{
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

/** Síncrono de propósito: só registra: o import mora dentro da `action`. */
export function registerLeaves(program: Command, only?: string): void {
  for (const leaf of LEAVES) {
    if (only && leaf.name !== only) continue;
    program
      .command(leaf.name)
      .description(leaf.description)
      .action(async () => {
        await (await leaf.load())();
      });
  }
}

/**
 * `true` quando o programa precisa da árvore inteira: help, completion e
 * qualquer coisa que enumere comandos. Errar para o lado de carregar tudo é
 * barato; errar para o outro esconde comando do usuário.
 */
function needsEveryCommand(target: string | undefined): boolean {
  if (!target || target.startsWith("-")) return true; // sem args, --help, flags
  return target === "help" || target === "completion";
}

/** `--version`/`-V`: o commander responde sozinho, sem consultar a árvore. */
function isVersionFlag(target: string | undefined): boolean {
  return target === "--version" || target === "-V";
}

/**
 * `argv` no formato de `process.argv` (o comando é o índice 2).
 */
export async function buildProgramFor(
  argv: readonly string[],
  logoShown: () => boolean = () => false,
): Promise<Command> {
  const program = createBaseProgram(logoShown);
  const target = argv[2];

  // Antes do fallback: sem isto `--version` não casa com módulo nenhum e cairia
  // no "carrega tudo" do fim, que é exatamente o custo que queremos evitar.
  if (isVersionFlag(target)) return program;

  if (needsEveryCommand(target)) {
    for (const m of MODULES) (await m.load())(program);
    registerLeaves(program);
    return program;
  }

  const hit = MODULES.find((m) => m.names.includes(target!));
  if (hit) {
    (await hit.load())(program);
    return program;
  }
  if (LEAVES.some((l) => l.name === target)) {
    registerLeaves(program, target);
    return program;
  }

  // Nome desconhecido: pode ser typo (o commander precisa da lista para sugerir)
  // ou um comando que esqueci de mapear. Carrega tudo — lento, porém correto.
  for (const m of MODULES) (await m.load())(program);
  registerLeaves(program);
  return program;
}
