/**
 * Esteira de onboarding — a camada que sabe "em que ponto o usuário está" e
 * conduz pro próximo passo, em vez de cada comando morrer no shell. Usada pelo
 * `nio` sem args, pelo `nio start`, e como tail-call de `login`/`config setup`.
 */
import { confirm, select } from "../../lib/prompts.js";
import { box, c, cmd, sym } from "../../lib/colors.js";
import { dlog } from "../../lib/debug.js";
import { checkConfig } from "../../lib/auth/nio-config.js";
import { loadSession } from "../../lib/auth/session-store.js";
import { gatewayHealth, ensureGatewayRunning } from "../../lib/auth/gateway-process.js";
import { createSessionRepository } from "../../adapters/pg/session-repository.js";
import { isBinaryInstalled } from "../../lib/clients/client-install.js";
import { handoffToOperator } from "../commands/init/handoff.js";

export type Stage = "config" | "gateway" | "login" | "session" | "ready";

export interface StageDeps {
  configOk: () => Promise<boolean>;
  gatewayHealth: () => Promise<boolean>;
  loadSession: () => Promise<{ userId: number; expiresAt: string } | null>;
  findActive: (userId: number) => Promise<unknown | null>;
}

const realDeps: StageDeps = {
  configOk: async () => (await checkConfig()).length === 0,
  gatewayHealth: () => gatewayHealth(),
  loadSession,
  findActive: (userId) => createSessionRepository().findActiveByUser(userId),
};

/** Devolve o primeiro estágio não satisfeito (config → gateway → login → session → ready). */
export async function resolveStage(deps: Partial<StageDeps> = {}): Promise<Stage> {
  const d = { ...realDeps, ...deps };
  if (!(await d.configOk())) return "config";
  if (!(await d.gatewayHealth())) return "gateway";
  const session = await d.loadSession();
  if (!session || new Date(session.expiresAt).getTime() <= Date.now()) return "login";
  const active = await d.findActive(session.userId);
  if (!active) return "session";
  return "ready";
}

const STAGE_META: Record<Exclude<Stage, "ready">, { label: string; resumeCmd: string }> = {
  config: { label: "Configurar credenciais", resumeCmd: "nio config setup" },
  gateway: { label: "Subir o gateway de auth", resumeCmd: "nio-gateway" },
  login: { label: "Entrar", resumeCmd: "nio login" },
  session: { label: "Montar a sessão", resumeCmd: "nio init" },
};

function gatewayDownBox(): string {
  return box(
    `${c.yellow(sym.warn)} ${c.bold("Não consegui subir o nio-gateway automaticamente.")}\n` +
      `${c.dim("abra noutra janela:")} ${cmd("nio-gateway")}\n` +
      `${c.dim("depois retome com:")} ${cmd("nio start")}`,
    { borderColor: "yellow", title: "Gateway necessário" },
  );
}

/** Executa o passo de um estágio. Imports lazy quebram o ciclo com auth.ts/init. */
async function runStage(stage: Exclude<Stage, "ready">): Promise<void> {
  if (stage === "config") {
    const { runConfigWizard } = await import("../../lib/auth/nio-config.js");
    await runConfigWizard();
    return;
  }
  if (stage === "gateway") {
    const result = await ensureGatewayRunning();
    if (!result.ok) console.log(gatewayDownBox());
    return;
  }
  if (stage === "login") {
    const auth = await import("../commands/auth.js");
    const choice = await select<"login" | "register">({
      message: "Você já tem usuário no NIO?",
      choices: [
        { name: "Sim — entrar", value: "login" },
        { name: "Não — criar um agora", value: "register" },
      ],
      default: "login",
    });
    await (choice === "register" ? auth.runRegister() : auth.runLogin());
    return;
  }
  const { runInitWizard } = await import("../commands/init/index.js");
  await runInitWizard();
}

/** Estágio `ready`: sessão ativa existe. Oferece abrir o OpenCode. */
async function handleReady(): Promise<void> {
  const session = await loadSession();
  const active = session ? await createSessionRepository().findActiveByUser(session.userId) : null;
  if (active) {
    console.log(
      `\n${c.green(sym.ok)} Tudo pronto — sessão ativa: ${c.bold(active.name)} (${active.profile}).`,
    );
  }
  if (!process.stdin.isTTY) return;
  if (!isBinaryInstalled("opencode")) {
    console.log(c.dim("Instale o OpenCode e rode `opencode` nesta pasta, ou `nio init` pra recriar o ambiente."));
    return;
  }
  if (await confirm({ message: "Abrir o OpenCode agora?", default: true })) {
    await handoffToOperator();
  }
}

type StageMeta = { label: string; resumeCmd: string };

/** `true` = seguir com o passo. `false` (com mensagem já impressa) = parar aqui. */
async function askToProceed(meta: StageMeta): Promise<boolean> {
  if (!process.stdin.isTTY) {
    console.log(`Próximo passo: ${cmd(meta.resumeCmd)}`);
    return false;
  }
  const go = await confirm({
    message: `Próximo: ${meta.label} (${cmd(meta.resumeCmd)}). Seguir agora?`,
    default: true,
  });
  if (!go) {
    console.log(c.dim(`Retome quando quiser:  ${cmd("nio start")}   (ou \`${meta.resumeCmd}\` direto)`));
  }
  return go;
}

/**
 * O laço da esteira. `from: 'cold'` toca o logo antes (uso do `nio`/`nio start`);
 * `from: 'command'` é o tail-call de um comando que acabou de rodar.
 */
export async function continueChain(opts: { from: "cold" | "command" }): Promise<void> {
  if (opts.from === "cold") {
    const { animateMatrixLogo } = await import("../../matrix-logo.js");
    await animateMatrixLogo();
  }

  for (let guard = 0; guard < 8; guard++) {
    const stage = await resolveStage();
    dlog("esteira: stage =", stage);
    if (stage === "ready") return handleReady();

    const meta = STAGE_META[stage];
    if (!(await askToProceed(meta))) return;

    await runStage(stage);
    // `nio init` já termina fazendo o handoff pro OpenCode — não volta pro laço
    // (senão o `handleReady` ofereceria abrir o OpenCode de novo).
    if (stage === "session") return;
    if ((await resolveStage()) === stage) {
      console.log(c.dim(`Ainda em "${meta.label}". Resolva o que faltou e rode ${cmd("nio start")} de novo.`));
      return;
    }
  }
}
