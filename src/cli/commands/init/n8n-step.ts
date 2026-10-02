/**
 * Passo de n8n do `nio init` (só no perfil fullstack, quando a linguagem n8n é escolhida):
 * registra o `n8n-mcp` (docs de nodes) e oferece conectar o MCP **nativo** da instância.
 *
 * Antes, o nativo só entrava se `N8N_NATIVE_MCP_URL` já estivesse exportada — ninguém
 * descobria o nome da var. Agora o passo pergunta e grava em `~/.nio/config.env`.
 */
import type { McpSpec } from "../../../core/environment.js";
import type { EnvironmentConfig } from "../../../core/types.js";
import type { SessionManager } from "../../../app/session-manager.js";
import { c, sym } from "../../../lib/colors.js";
import { confirm } from "../../../lib/prompts.js";
import { readConfigFile, writeConfigFile } from "../../../lib/auth/nio-config.js";
import {
  promptN8nNativeCredentials,
  verifyN8nNativeCredentials,
  n8nNativeStatus,
} from "../../../lib/auth/n8n-config.js";
import { n8nMcp, buildN8nNativeMcp } from "../../../profiles/mcps.js";
import { readToolsCache } from "../../../adapters/n8n/tools-cache.js";

/** Conecta o MCP nativo, ou `null` se o usuário pular / a credencial não validar. */
async function connectNative(): Promise<McpSpec | null> {
  const updates = await promptN8nNativeCredentials(readConfigFile());
  if (!updates) return null;

  const res = await verifyN8nNativeCredentials(updates);
  if (!res.ok) {
    console.log(`  ${c.yellow(sym.warn)} ${res.detail}`);
    console.log(`  ${c.dim("segue sem o MCP nativo; as tools REST continuam valendo")}`);
    return null;
  }
  writeConfigFile(updates);
  console.log(`  ${c.green(sym.ok)} MCP nativo do n8n: ${res.detail}.`);
  return buildN8nNativeMcp(res.tools);
}

/**
 * MCPs de n8n a registrar. Já configurado (env + cache) entra direto, sem perguntar;
 * senão oferece a conexão.
 */
async function resolveN8nMcps(): Promise<McpSpec[]> {
  const specs: McpSpec[] = [n8nMcp];

  if (n8nNativeStatus().configured) {
    specs.push(buildN8nNativeMcp(readToolsCache().tools));
    return specs;
  }

  console.log(`  ${c.dim("o MCP nativo da instância dá acesso a workflows, execuções e builder")}`);
  if (!(await confirm({ message: "conectar o MCP nativo do n8n agora?", default: true }))) {
    console.log(`  ${c.dim(`depois, rode ${c.bold("nio n8n connect")}`)}`);
    return specs;
  }
  const native = await connectNative();
  if (native) specs.push(native);
  return specs;
}

export interface N8nStepContext {
  mcps: McpSpec[];
  envConfig: EnvironmentConfig | undefined;
  manager: SessionManager;
  sessionId: string;
}

/** Registra os MCPs de n8n na sessão e devolve a lista atualizada. */
export async function registerN8nMcps(ctx: N8nStepContext): Promise<McpSpec[]> {
  const added = (await resolveN8nMcps()).filter((w) => !ctx.mcps.some((m) => m.id === w.id));
  if (added.length === 0) return ctx.mcps;

  if (ctx.envConfig) {
    const ids = Array.from(new Set([...(ctx.envConfig.mcps ?? []), ...added.map((a) => a.id)]));
    await ctx.manager.updateConfig(ctx.sessionId, { ...ctx.envConfig, mcps: ids });
  }
  console.log(`  ${c.green(sym.ok)} registrado: ${added.map((a) => a.id).join(", ")}.`);
  if (!process.env.N8N_API_KEY?.trim()) {
    console.log(`  ${c.dim("exporte N8N_API_URL e N8N_API_KEY pras tools REST de fallback")}`);
  }
  return [...ctx.mcps, ...added];
}
