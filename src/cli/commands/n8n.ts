import type { Command } from "commander";
import { section, c, sym } from "../../lib/colors.js";
import { startSpinner } from "../../lib/spinner.js";
import { readConfigFile, writeConfigFile } from "../../lib/auth/nio-config.js";
import {
  promptN8nNativeCredentials,
  verifyN8nNativeCredentials,
  n8nNativeStatus,
} from "../../lib/auth/n8n-config.js";
import { readToolsCache } from "../../adapters/n8n/tools-cache.js";
import { isN8nNativeReadTool } from "../../profiles/n8n-native-tools.js";

/** `nio n8n …` — MCP nativo da instância (Settings > Instance-level MCP). */
export function registerN8nCommand(program: Command): void {
  const n8n = program.command("n8n").description("MCP nativo da instância n8n");

  n8n
    .command("connect")
    .description("Conecta/renova o MCP nativo do n8n e redetecta as tools da instância")
    .action(async () => {
      section("n8n", "conectando o MCP nativo da instância");
      const updates = await promptN8nNativeCredentials(readConfigFile());
      if (!updates) {
        console.log(`  ${c.dim("nada alterado")}`);
        return;
      }

      const spinner = startSpinner("Validando e detectando tools…");
      const res = await verifyN8nNativeCredentials(updates);
      spinner.stop();

      if (!res.ok) {
        console.log(`  ${c.red(sym.err)} ${res.detail}`);
        process.exitCode = 1;
        return;
      }
      writeConfigFile(updates);
      console.log(`  ${c.green(sym.ok)} ${res.detail}.`);
      console.log(`  ${c.dim(`rode ${c.bold("nio sync")} pra propagar pro opencode.json`)}`);
    });

  n8n
    .command("status")
    .description("Mostra a credencial configurada e as tools detectadas")
    .action(() => {
      section("n8n", "estado do MCP nativo");
      const status = n8nNativeStatus();
      const cache = readToolsCache();

      if (!status.configured) {
        console.log(`  ${c.yellow(sym.warn)} sem credencial no ambiente.`);
        console.log(`  ${c.dim(`rode ${c.bold("nio n8n connect")}`)}`);
        return;
      }
      console.log(`  ${c.green(sym.ok)} instância: ${status.url}`);
      if (cache.tools.length === 0) {
        console.log(`  ${c.yellow(sym.warn)} nenhuma tool em cache — tudo pede aprovação.`);
        console.log(`  ${c.dim(`rode ${c.bold("nio n8n connect")} pra detectar`)}`);
        return;
      }
      const ask = cache.tools.filter((tool) => !isN8nNativeReadTool(tool));
      const versao = cache.serverVersion ? ` (${cache.serverVersion})` : "";
      console.log(`  ${c.green(sym.ok)} ${cache.tools.length} tools${versao}`);
      console.log(`  ${c.dim(`${cache.tools.length - ask.length} livres (leitura)`)}`);
      console.log(`  ${c.dim(`${ask.length} pedem aprovação: ${ask.join(", ")}`)}`);
    });
}
