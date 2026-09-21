/**
 * `nio fabric` — integração com o Power BI/Fabric via service principal.
 * `status` (default) faz o preflight: confere as credenciais `AZURE_*` e tenta
 * listar os workspaces como smoke test, sem nunca imprimir segredo.
 */
import type { Command } from "commander";
import { c, sym } from "../../lib/colors.js";
import { readFabricAuthEnv } from "../../adapters/fabric/token.js";
import { createFabricGateway } from "../../adapters/fabric/client.js";

const HINT = "Configure AZURE_TENANT_ID, AZURE_CLIENT_ID e AZURE_CLIENT_SECRET em ~/.nio/config.env";

interface FabricStatusReport {
  configured: boolean;
  status: "ok" | "unconfigured" | "unauthorized" | "unavailable" | "failed";
  workspaceCount?: number;
  error?: string;
}

async function probe(): Promise<FabricStatusReport> {
  const auth = readFabricAuthEnv();
  if (!auth.tenantId || !auth.clientId || !auth.clientSecret) {
    return { configured: false, status: "unconfigured" };
  }
  const out = await createFabricGateway().listWorkspaces();
  if (out.status === "ok") return { configured: true, status: "ok", workspaceCount: out.data?.length ?? 0 };
  return { configured: true, status: out.status, error: out.error };
}

async function runStatus(opts: { json?: boolean }): Promise<void> {
  const r = await probe();
  if (opts.json) {
    console.log(JSON.stringify(r));
    process.exit(r.status === "ok" ? 0 : 1);
  }
  if (r.status === "ok") {
    console.log(`${c.green(sym.ok)} Fabric conectado — ${r.workspaceCount} workspace(s) visível(is) ao service principal.`);
    return;
  }
  if (r.status === "unconfigured") {
    console.log(`${c.yellow(sym.warn)} Fabric não configurado. ${c.dim(HINT)}`);
    process.exit(1);
  }
  const label =
    r.status === "unauthorized"
      ? "sem acesso (service principal sem permissão, tenant setting desabilitado, ou RLS/SSO no dataset)"
      : r.status === "unavailable"
        ? "indisponível (rede/timeout)"
        : "falhou";
  console.log(`${c.red(sym.err)} Fabric ${label}. ${c.dim(r.error ?? "")}`);
  process.exit(1);
}

export function registerFabricCommand(program: Command): void {
  const fabric = program.command("fabric").description("Integração com o Power BI/Fabric (service principal)");

  fabric
    .command("status", { isDefault: true })
    .description("Preflight: confere as credenciais AZURE_* e lista workspaces")
    .option("--json", "saída estável em JSON")
    .action(runStatus);
}
