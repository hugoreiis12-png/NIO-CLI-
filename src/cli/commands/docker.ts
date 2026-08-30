/**
 * `nio docker *` — camada Docker. `toolkit`/`portainer` sobem a infra NIO;
 * `compose`/`create` são wrapper determinístico sobre `docker`; `debug`/`orquest`/
 * `cluster` fazem handoff pro operador de IA. Ver `docs/arch/ARQUITETURA-DOCKER.md`.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type { Command } from "commander";
import { brand } from "../../brand.js";
import { c, sym, section, link } from "../../lib/colors.js";
import { input, confirm } from "../../lib/prompts.js";
import {
  CLUSTER_STACK,
  DOCKER_MCP_URL,
  PORTAINER_URL,
  dockerAvailable,
  infraComposePath,
  mcpGatewayHealthy,
  portainerHealthy,
  unreachableDocker,
} from "../../lib/docker.js";
import { upsertOpencodeMcp } from "../../lib/client-configs.js";
import { isBinaryInstalled } from "../../lib/client-install.js";
import { openUrl } from "../../lib/open-url.js";
import { loadSession } from "../../lib/session-store.js";
import { createSessionRepository } from "../../adapters/pg/session-repository.js";
import { createDockerGateway } from "../../adapters/docker/docker-gateway.js";
import {
  buildClusterPrompt,
  buildDebugPrompt,
  buildOrquestPrompt,
  collectDebugContext,
  parseScaleArg,
  parseStackServices,
  persistClusterState,
  readClusterState,
  runOperator,
} from "../../app/docker-manager.js";
import type { ClusterAction, ComposeAction, DockerResult, RunSpec } from "../../core/docker.js";
import type { Session } from "../../core/session.js";
import { dockerGatewayMcp } from "../../profiles/mcps.js";

/** `docker` está utilizável? Senão, erro acionável + exit 1. */
function requireDocker(): void {
  if (!dockerAvailable()) {
    console.error(`${c.red(sym.err)} ${unreachableDocker().message}`);
    process.exit(1);
  }
}

/** Sessão ativa do usuário logado, ou encerra (padrão do `nio deps`). */
async function requireActiveSession(): Promise<Session> {
  const stored = await loadSession();
  if (!stored) {
    console.error(`${c.yellow(sym.warn)} Não autenticado. Rode ${c.cyan(`${brand.name} login`)}.`);
    process.exit(1);
  }
  let session: Session | null;
  try {
    session = await createSessionRepository().findActiveByUser(stored.userId);
  } catch (err) {
    console.error(`${c.red(sym.err)} Falha no banco: ${(err as Error).message}`);
    process.exit(1);
    throw err;
  }
  if (!session) {
    console.error(
      `${c.yellow(sym.warn)} Nenhuma sessão ativa. Rode ${c.cyan(`${brand.name} init`)} ou ` +
        `${c.cyan(`${brand.name} sessions activate <id>`)}.`,
    );
    process.exit(1);
  }
  return session;
}

/** O operador (`opencode`) está no PATH? Senão, orienta + exit 1. */
function requireOperator(): void {
  if (!isBinaryInstalled("opencode")) {
    console.error(
      `${c.yellow(sym.warn)} OpenCode não encontrado no PATH — \`nio docker debug/orquest/cluster\` ` +
        `dependem dele. Instale com \`npm i -g opencode-ai\`.`,
    );
    process.exit(1);
  }
}

/** `docker compose -f <infra> …` herdando o terminal. Retorna o exit code. */
function infraCompose(args: string[]): number {
  const res = spawnSync("docker", ["compose", "-f", infraComposePath(), ...args], {
    stdio: "inherit",
  });
  return res.status ?? 1;
}

// ─── toolkit ─────────────────────────────────────────────────────────

async function toolkitUp(): Promise<void> {
  requireDocker();
  section("Docker toolkit", "subindo MCP Gateway + Portainer");

  if (infraCompose(["up", "-d"]) !== 0) {
    console.error(`${c.red(sym.err)} Falha ao subir a infra (\`docker compose\` saiu != 0).`);
    process.exit(1);
  }

  // Registra o gateway remoto no opencode.json — o operador ganha as tools Docker.
  try {
    const r = upsertOpencodeMcp(dockerGatewayMcp);
    const msg = { created: "criado", updated: "atualizado", already_configured: "já estava" }[r.status];
    console.log(`  ${c.green(sym.ok)} opencode.json — MCP \`docker\` ${msg} (${c.dim(DOCKER_MCP_URL)})`);
    if (r.backup) console.log(`  ${c.dim(`backup: ${r.backup}`)}`);
  } catch (err) {
    console.warn(`  ${c.yellow(sym.warn)} não consegui registrar o MCP no opencode.json: ${(err as Error).message}`);
  }

  const [gw, pt] = await Promise.all([mcpGatewayHealthy(), portainerHealthy()]);
  console.log("");
  console.log(`  ${gw ? c.green(sym.ok) : c.yellow(sym.warn)} MCP Gateway  ${c.dim(DOCKER_MCP_URL)}`);
  console.log(`  ${pt ? c.green(sym.ok) : c.yellow(sym.warn)} Portainer    ${c.dim(PORTAINER_URL)}`);
  console.log("");
  console.log(c.dim(`  1º acesso ao Portainer pede setup de admin — abra ${PORTAINER_URL} e crie o usuário.`));
  console.log(c.dim(`  reinicie o \`opencode\` da sessão pra ele pegar as tools Docker.`));
}

async function toolkitDown(): Promise<void> {
  requireDocker();
  section("Docker toolkit", "derrubando MCP Gateway + Portainer");
  infraCompose(["down"]);
  try {
    const r = upsertOpencodeMcp(dockerGatewayMcp, { remove: true });
    if (r.status !== "already_configured") {
      console.log(`  ${c.green(sym.ok)} MCP \`docker\` desabilitado no opencode.json`);
    }
  } catch {
    /* best-effort */
  }
}

async function toolkitStatus(): Promise<void> {
  requireDocker();
  section("Docker toolkit", "status");
  infraCompose(["ps"]);
  const [gw, pt] = await Promise.all([mcpGatewayHealthy(), portainerHealthy()]);
  console.log("");
  console.log(`  ${gw ? c.green(sym.ok) : c.red(sym.err)} MCP Gateway  ${c.dim(DOCKER_MCP_URL)}`);
  console.log(`  ${pt ? c.green(sym.ok) : c.red(sym.err)} Portainer    ${c.dim(PORTAINER_URL)}`);
}

// ─── compose (projeto) ───────────────────────────────────────────────

/** Reporta um `DockerResult` e sai 1 se falhou. `ok` já streamou/imprimiu. */
function reportResult(res: DockerResult, whatFailed: string): void {
  if (res.status === "unavailable") {
    console.error(`${c.red(sym.err)} ${res.error}`);
    process.exit(1);
  }
  if (res.status === "failed") {
    console.error(`${c.red(sym.err)} ${whatFailed}: ${res.error}`);
    process.exit(1);
  }
  if (res.stdout) console.log(res.stdout);
}

const COMPOSE_ACTIONS: readonly ComposeAction[] = ["up", "down", "restart", "ps", "logs"];

async function runCompose(
  action: string,
  service: string | undefined,
  opts: { file?: string; detach?: boolean; build?: boolean; tail?: string },
): Promise<void> {
  requireDocker();
  if (!COMPOSE_ACTIONS.includes(action as ComposeAction)) {
    console.error(`${c.red(sym.err)} ação inválida "${action}" — use: ${COMPOSE_ACTIONS.join(" | ")}`);
    process.exit(1);
  }
  const file = opts.file ? resolve(opts.file) : undefined;
  if (file && !existsSync(file)) {
    console.error(`${c.red(sym.err)} compose file não encontrado: ${file}`);
    process.exit(1);
  }
  section("docker compose", `${action}${service ? ` ${service}` : ""}${file ? ` (${file})` : ""}`);
  const res = await createDockerGateway().compose(action as ComposeAction, {
    file,
    detach: opts.detach,
    build: opts.build,
    service,
    tail: opts.tail ? Number(opts.tail) : undefined,
  });
  reportResult(res, `docker compose ${action}`);
}

// ─── create ──────────────────────────────────────────────────────────

/** `"a,b, c"` → `["a","b","c"]` (vazio → `[]`). */
function splitList(v?: string): string[] {
  return (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

async function runCreate(opts: {
  image?: string;
  name?: string;
  port?: string;
  env?: string;
  volume?: string;
  detach?: boolean;
  yes?: boolean;
}): Promise<void> {
  requireDocker();
  section("docker create", "novo container");

  const image =
    opts.image?.trim() ||
    (await input({
      message: "Imagem (ex.: redis:7, node:20)",
      validate: (v) => v.trim().length > 0 || "obrigatório",
    })).trim();

  const interactive = !opts.image && process.stdout.isTTY;
  const name =
    opts.name?.trim() ||
    (interactive ? (await input({ message: "Nome do container (opcional)", default: "" })).trim() : "");
  const ports = opts.port
    ? splitList(opts.port)
    : interactive
      ? splitList(await input({ message: "Portas host:container, separadas por vírgula (opcional)", default: "" }))
      : [];
  const env = Object.fromEntries(
    (opts.env
      ? splitList(opts.env)
      : interactive
        ? splitList(await input({ message: "Env KEY=VALUE, separadas por vírgula (opcional)", default: "" }))
        : []
    )
      .map((pair) => pair.split("="))
      .filter((kv) => kv.length === 2)
      .map(([k, v]) => [k!.trim(), v!.trim()]),
  );
  const volumes = opts.volume
    ? splitList(opts.volume)
    : interactive
      ? splitList(await input({ message: "Volumes host:container, separados por vírgula (opcional)", default: "" }))
      : [];

  const spec: RunSpec = {
    image,
    name: name || undefined,
    ports: ports.length ? ports : undefined,
    env: Object.keys(env).length ? env : undefined,
    volumes: volumes.length ? volumes : undefined,
    detach: opts.detach ?? true,
  };

  console.log(`  ${c.dim(`docker run ${spec.detach ? "-d " : ""}${name ? `--name ${name} ` : ""}${image}`)}`);
  const ok =
    opts.yes === true ||
    (interactive && (await confirm({ message: "Criar e subir o container?", default: true })));
  if (!ok) {
    console.log(c.dim(interactive ? "cancelado." : "sem TTY — passe `-y` pra criar sem confirmação."));
    return;
  }

  reportResult(await createDockerGateway().run(spec), "docker run");
}

// ─── debug (operador) ────────────────────────────────────────────────

async function runDebug(container: string | undefined, opts: { json?: boolean }): Promise<void> {
  requireDocker();
  const gateway = createDockerGateway();

  if (!container) {
    // sem alvo → lista os containers pra o usuário escolher
    section("docker debug", "nenhum container informado — containers do host:");
    reportResult(await gateway.ps(true), "docker ps");
    console.log(c.dim(`\n  rode \`${brand.name} docker debug <nome|id>\``));
    return;
  }

  if (!opts.json) requireOperator();
  const ctx = await collectDebugContext(gateway, container);

  if (opts.json) {
    console.log(JSON.stringify(ctx, null, 2));
    return;
  }

  section("docker debug", `${container} — entregando pro operador`);
  const code = await runOperator(buildDebugPrompt(ctx));
  if (code !== 0) process.exitCode = code;
}

// ─── orquest (operador) ──────────────────────────────────────────────

async function runOrquest(
  instruction: string | undefined,
  opts: { dryRun?: boolean },
): Promise<void> {
  requireDocker();
  requireOperator();
  const session = await requireActiveSession();

  const task =
    instruction?.trim() ||
    (await input({
      message: "O que orquestrar? (linguagem natural)",
      validate: (v) => v.trim().length > 0 || "descreva a tarefa",
    })).trim();

  section("docker orquest", opts.dryRun ? `${task} (dry-run)` : task);
  const code = await runOperator(
    buildOrquestPrompt(task, session.projectPath, Boolean(opts.dryRun)),
    { cwd: session.projectPath },
  );
  if (code !== 0) process.exitCode = code;
}

// ─── cluster (Swarm) ─────────────────────────────────────────────────

const CLUSTER_ACTIONS: readonly ClusterAction[] = ["up", "down", "status", "scale"];

async function runCluster(action: string, arg: string | undefined, opts: { dryRun?: boolean }): Promise<void> {
  requireDocker();
  if (!CLUSTER_ACTIONS.includes(action as ClusterAction)) {
    console.error(`${c.red(sym.err)} ação inválida "${action}" — use: ${CLUSTER_ACTIONS.join(" | ")}`);
    process.exit(1);
  }
  const session = await requireActiveSession();
  const gateway = createDockerGateway();
  const repo = createSessionRepository();

  if (action === "status") {
    section("docker cluster", `stack ${CLUSTER_STACK}`);
    const live = await gateway.stackServices(CLUSTER_STACK);
    if (live.status !== "ok") {
      console.log(c.dim("  stack não encontrada (nunca deployada, ou Swarm inativo)."));
    } else {
      for (const s of parseStackServices(live.stdout ?? "")) {
        console.log(`  ${c.green(sym.dot)} ${s.name}  ${c.dim(s.replicas)}`);
      }
    }
    const persisted = readClusterState(session);
    if (persisted) {
      console.log(c.dim(`\n  persistido: ${persisted.services.length} serviço(s), deploy ${persisted.deployedAt}`));
    }
    return;
  }

  if (action === "down") {
    section("docker cluster", `removendo stack ${CLUSTER_STACK}`);
    reportResult(await gateway.stackRm(CLUSTER_STACK), "docker stack rm");
    await persistClusterState(repo, session, null).catch(() => {});
    console.log(`  ${c.green(sym.ok)} estado limpo em ${brand.projectConfigFile} (sessão)`);
    return;
  }

  if (action === "scale") {
    const parsed = arg ? parseScaleArg(arg) : null;
    if (!parsed) {
      console.error(`${c.red(sym.err)} use \`${brand.name} docker cluster scale <servico>=<n>\``);
      process.exit(1);
    }
    section("docker cluster", `scale ${parsed.service}=${parsed.replicas}`);
    reportResult(
      await gateway.serviceScale(`${CLUSTER_STACK}_${parsed.service}`, parsed.replicas),
      "docker service scale",
    );
    return;
  }

  // action === "up"
  requireOperator();
  const instruction =
    arg?.trim() ||
    (await input({
      message: "O que subir no cluster? (ex.: api + worker + redis + postgres)",
      validate: (v) => v.trim().length > 0 || "descreva os serviços",
    })).trim();

  section("docker cluster", `up — ${instruction}`);
  const init = await gateway.swarmInit();
  if (init.status === "failed") {
    console.error(`${c.red(sym.err)} docker swarm init: ${init.error}`);
    process.exit(1);
  }

  const code = await runOperator(buildClusterPrompt(instruction, session.projectPath), {
    cwd: session.projectPath,
  });
  if (code !== 0) {
    console.warn(`${c.yellow(sym.warn)} operador saiu com código ${code} — validando o estado real...`);
  }

  // Validação: pergunta ao Docker (não confia na saída do operador) e persiste.
  const live = await gateway.stackServices(CLUSTER_STACK);
  const services = live.status === "ok" ? parseStackServices(live.stdout ?? "").map((s) => s.name) : [];
  if (services.length === 0) {
    console.error(`${c.red(sym.err)} nenhum serviço na stack ${CLUSTER_STACK} — o deploy não completou.`);
    process.exit(1);
  }
  await persistClusterState(repo, session, {
    stack: CLUSTER_STACK,
    services,
    composePath: "(gerado pelo operador)",
    deployedAt: new Date().toISOString(),
  }).catch((err) => console.warn(`${c.yellow(sym.warn)} não persisti o estado: ${(err as Error).message}`));

  console.log(`\n  ${c.green(sym.ok)} stack ${CLUSTER_STACK} — ${services.length} serviço(s): ${services.join(", ")}`);
}

// ─── portainer ───────────────────────────────────────────────────────

async function runPortainer(opts: { url?: boolean }): Promise<void> {
  if (opts.url) {
    console.log(PORTAINER_URL);
    return;
  }
  if (!(await portainerHealthy())) {
    console.error(
      `${c.yellow(sym.warn)} Portainer não está no ar. Rode ${c.cyan(`${brand.name} docker toolkit up`)}.`,
    );
    process.exit(1);
  }
  console.log(`${c.green(sym.ok)} Abrindo ${link(PORTAINER_URL)}`);
  openUrl(PORTAINER_URL);
}

// ─── registro ────────────────────────────────────────────────────────

export function registerDockerCommand(program: Command): void {
  const cmd = program
    .command("docker")
    .description("Camada Docker: MCP Gateway + Portainer, compose, debug e cluster (Swarm)");

  const toolkit = cmd
    .command("toolkit")
    .description("Infra NIO: Docker MCP Gateway + Portainer (docker/docker-compose.yml)");
  toolkit.command("up", { isDefault: true }).description("Sobe a infra e registra o gateway no opencode.json").action(toolkitUp);
  toolkit.command("down").description("Derruba a infra e desabilita o MCP no opencode.json").action(toolkitDown);
  toolkit.command("status").description("Estado dos containers + health dos endpoints").action(toolkitStatus);

  cmd
    .command("compose <action> [service]")
    .description(`Wrapper sobre \`docker compose\` do projeto (${COMPOSE_ACTIONS.join("|")})`)
    .option("-f, --file <path>", "compose file (default: ./docker-compose.yml)")
    .option("-d, --detach", "up em background (default)")
    .option("--no-detach", "up em foreground")
    .option("--build", "up com rebuild das imagens")
    .option("--tail <n>", "linhas de logs")
    .action(runCompose);

  cmd
    .command("create")
    .description("Cria e sobe um container (wizard ou flags)")
    .option("--image <ref>", "imagem (pula o wizard)")
    .option("--name <name>", "nome do container")
    .option("--port <list>", "portas host:container separadas por vírgula")
    .option("--env <list>", "env KEY=VALUE separadas por vírgula")
    .option("--volume <list>", "volumes host:container separados por vírgula")
    .option("--no-detach", "roda em foreground")
    .option("-y, --yes", "não pede confirmação")
    .action(runCreate);

  cmd
    .command("debug [container]")
    .description("Coleta o contexto de um container e entrega o diagnóstico pro operador de IA")
    .option("--json", "só imprime o contexto coletado (ps/logs/inspect)")
    .action(runDebug);

  cmd
    .command("orquest [instruction]")
    .description("Orquestra os serviços do projeto via compose, dirigido pelo operador (linguagem natural)")
    .option("--dry-run", "gera o compose e mostra, sem aplicar")
    .action(runOrquest);

  cmd
    .command("cluster <action> [arg]")
    .description(`Docker Swarm — stack \`${CLUSTER_STACK}\` (${CLUSTER_ACTIONS.join("|")})`)
    .action(runCluster);

  cmd
    .command("portainer")
    .description("Abre o Portainer no navegador")
    .option("--url", "só imprime a URL")
    .action(runPortainer);
}
