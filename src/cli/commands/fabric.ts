/**
 * `nio fabric` — integração com o Power BI/Fabric via service principal.
 * `status` (default) faz o preflight: confere as credenciais `AZURE_*` e tenta
 * listar os workspaces como smoke test, sem nunca imprimir segredo.
 */
import type { Command } from "commander";
import { c, sym } from "../../lib/colors.js";
import { fabricGrant, type TokenGrant } from "../../adapters/fabric/token.js";
import { createFabricGateway } from "../../adapters/fabric/client.js";
import { registerFabricRagCommands } from "./fabric-rag.js";
import { discoverLocalXmla } from "../../adapters/powerbi/local-endpoint.js";

const HINT =
  "Configure AZURE_TENANT_ID/AZURE_CLIENT_ID e (NIO_FABRIC_USERNAME/PASSWORD p/ token de usuário com RLS, " +
  "ou AZURE_CLIENT_SECRET p/ service principal) em ~/.nio/config.env";

interface FabricStatusReport {
  configured: boolean;
  grant?: TokenGrant;
  status: "ok" | "unconfigured" | "unauthorized" | "unavailable" | "failed";
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

async function runStatus(opts: { json?: boolean }): Promise<void> {
  const r = await probe();
  if (opts.json) {
    console.log(JSON.stringify(r));
    process.exit(r.status === "ok" ? 0 : 1);
  }
  if (r.status === "ok") {
    const via = r.grant === "user" ? "token de usuário (RLS aplicado)" : "service principal";
    console.log(`${c.green(sym.ok)} Fabric conectado via ${via} — ${r.workspaceCount} workspace(s) visível(is).`);
  } else if (r.status === "unconfigured") {
    console.log(`${c.yellow(sym.warn)} Fabric não configurado. ${c.dim(HINT)}`);
  } else {
    const label =
      r.status === "unauthorized"
        ? "sem acesso (service principal sem permissão, tenant setting desabilitado, ou RLS/SSO no dataset)"
        : r.status === "unavailable"
          ? "indisponível (rede/timeout)"
          : "falhou";
    console.log(`${c.red(sym.err)} Fabric ${label}. ${c.dim(r.error ?? "")}`);
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

export function registerFabricCommand(program: Command): void {
  const fabric = program.command("fabric").description("Integração com o Power BI/Fabric (service principal)");

  fabric
    .command("status", { isDefault: true })
    .description("Preflight: confere as credenciais AZURE_* e lista workspaces")
    .option("--json", "saída estável em JSON")
    .action(runStatus);

  registerFabricRagCommands(fabric);
}
