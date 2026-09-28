/**
 * `nio fabric` — integração com o Power BI/Fabric via service principal.
 * `status` (default) faz o preflight: confere as credenciais `AZURE_*` e tenta
 * listar os workspaces como smoke test, sem nunca imprimir segredo.
 */
import type { Command } from "commander";
import { c, sym } from "../../lib/colors.js";
import { fabricGrant, readFabricAuthEnv, type TokenGrant } from "../../adapters/fabric/token.js";
import { startDeviceAuth, pollDeviceToken } from "../../adapters/fabric/device-code.js";
import { saveRefreshToken, clearRefreshToken } from "../../adapters/fabric/refresh-store.js";
import { GRANT_LABEL } from "../../lib/auth/fabric-config.js";
import { createFabricGateway } from "../../adapters/fabric/client.js";
import type { FabricStatus } from "../../core/fabric.js";
import { registerFabricRagCommands } from "./fabric-rag.js";
import { discoverLocalXmla } from "../../adapters/powerbi/local-endpoint.js";

const HINT =
  "Configure AZURE_TENANT_ID/AZURE_CLIENT_ID e (NIO_FABRIC_USERNAME/PASSWORD p/ token de usuário com RLS, " +
  "ou AZURE_CLIENT_SECRET p/ service principal) em ~/.nio/config.env";

interface FabricStatusReport {
  configured: boolean;
  grant?: TokenGrant;
  status: FabricStatus | "unconfigured";
  workspaceCount?: number;
  error?: string;
}

async function probe(): Promise<FabricStatusReport> {
  const grant = fabricGrant();
  if (!grant) return { configured: false, status: "unconfigured" };
  const out = await createFabricGateway().listWorkspaces();
  if (out.status === "ok") return { configured: true, grant, status: "ok", workspaceCount: out.data?.length ?? 0 };
  return { configured: true, grant, status: out.status, error: out.error };
}

/**
 * Rótulo da falha. Quando o Entra devolveu um AADSTS, ele **já disse a causa** —
 * e um palpite genérico ao lado manda procurar no lugar errado: um AADSTS50126
 * (usuário/senha) com "service principal sem permissão" na frente já custou uma
 * sessão inteira de caça a permissão no portal do Azure.
 */
export function statusLabel(status: FabricStatusReport["status"], error?: string): string {
  if (status === "unauthorized") {
    return /AADSTS\d+/.test(error ?? "")
      ? "recusou a credencial"
      : "sem acesso (service principal sem permissão, tenant setting desabilitado, ou RLS/SSO no dataset)";
  }
  if (status === "unavailable") return "indisponível (rede/timeout)";
  if (status === "throttled") return "limitado (429) — aguarde antes de repetir";
  return "falhou";
}

async function runStatus(opts: { json?: boolean }): Promise<void> {
  const r = await probe();
  if (opts.json) {
    console.log(JSON.stringify(r));
    process.exit(r.status === "ok" ? 0 : 1);
  }
  if (r.status === "ok") {
    const via = GRANT_LABEL[r.grant ?? "service_principal"];
    console.log(`${c.green(sym.ok)} Fabric conectado via ${via} — ${r.workspaceCount} workspace(s) visível(is).`);
  } else if (r.status === "unconfigured") {
    console.log(`${c.yellow(sym.warn)} Fabric não configurado. ${c.dim(HINT)}`);
  } else {
    console.log(`${c.red(sym.err)} Fabric ${statusLabel(r.status, r.error)}. ${c.dim(r.error ?? "")}`);
  }

  // Independe da nuvem, e é **quando a credencial falha** que saber do Desktop aberto
  // mais importa: é a alternativa que resta. Reportar só no sucesso a escondia.
  await reportLocalXmla();
  if (r.status !== "ok") process.exit(1);
}

/**
 * Endpoint XMLA local, quando há Desktop aberto. Consultivo: o caminho REST não depende
 * dele. A porta é efêmera — imprimi-la evita o chute de `55100` que já custou uma sessão.
 */
async function reportLocalXmla(): Promise<void> {
  const local = await discoverLocalXmla();
  if (local.status === "ok") {
    console.log(`${c.green(sym.ok)} Power BI Desktop local — XMLA em ${c.cyan(local.endpoint ?? "")} ${c.dim("(porta muda a cada abertura)")}`);
  } else if (local.status === "not_running") {
    console.log(`${c.dim("  sem Desktop local com modelo aberto — o modo `--local` não tem onde conectar.")}`);
  }
}

/** `mm:ss` — o relógio do device code fala em minutos, não em 847 segundos. */
function mmss(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  return `${m}:${String(totalSec % 60).padStart(2, "0")}`;
}

/**
 * Login interativo (device code). É o caminho para dataset com RLS: o service
 * principal é barrado por design nesses, e o ROPC é recusado pelo Entra quando
 * há MFA. Aqui a pessoa aprova no navegador e a CLI guarda só o refresh token.
 */
async function runLogin(): Promise<void> {
  const auth = readFabricAuthEnv();
  const start = await startDeviceAuth(auth);
  if (start.status !== "ok") {
    console.log(`${c.red(sym.err)} não deu para iniciar o login: ${c.dim(start.error)}`);
    process.exit(1);
  }

  console.log("");
  console.log(`  Abra   ${c.cyan(start.data.verificationUri)}`);
  console.log(`  Código ${c.green(start.data.userCode)}`);
  console.log("");

  // Só em TTY: num pipe/captura o relógio vira ruído (mesma regra do logo).
  const tick = (restanteSec: number): void => {
    if (process.stdout.isTTY) process.stdout.write(`\r  ${c.dim(`aguardando aprovação… ${mmss(restanteSec)}`)}   `);
  };
  const tokens = await pollDeviceToken(auth, start.data, { onWaiting: tick });
  if (process.stdout.isTTY) process.stdout.write("\r\x1b[K");

  if (tokens.status !== "ok") {
    console.log(`${c.red(sym.err)} login não concluído: ${c.dim(tokens.error)}`);
    process.exit(1);
  }

  const { warning } = saveRefreshToken(tokens.data.refreshToken, auth);
  if (warning) console.log(`${c.yellow(sym.warn)} não consegui restringir a permissão do arquivo: ${c.dim(warning)}`);
  console.log(`${c.green(sym.ok)} Login concluído — as consultas passam a rodar como você, com o RLS aplicado.`);
  console.log(c.dim("  sai com `nio fabric logout`."));
}

function runLogout(): void {
  clearRefreshToken();
  console.log(`${c.green(sym.ok)} Sessão do Fabric encerrada. ${c.dim("volta a usar a credencial do config.env.")}`);
}

export function registerFabricCommand(program: Command): void {
  const fabric = program.command("fabric").description("Integração com o Power BI/Fabric");

  fabric
    .command("status", { isDefault: true })
    .description("Preflight: confere as credenciais AZURE_* e lista workspaces")
    .option("--json", "saída estável em JSON")
    .action(runStatus);

  fabric
    .command("login")
    .description("Login interativo no navegador (device code) — necessário para dataset com RLS")
    .action(runLogin);

  fabric
    .command("logout")
    .description("Esquece o login interativo e volta à credencial do config.env")
    .action(runLogout);

  registerFabricRagCommands(fabric);
}
