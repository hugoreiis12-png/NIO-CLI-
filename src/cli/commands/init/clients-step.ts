import { installOpencodeGlobal, installCodexGlobal, type InstallResult } from "../../../lib/client-configs.js";
import { printInstallResult } from "../../ui/render.js";
import type { McpSpec } from "../../../core/environment.js";
import type { PrimaryClient } from "../../../lib/primary-client.js";

// A escolha de cliente virou detecção (`resolvePrimaryClient` em flows/clients.ts):
// o `nio init` sobe o que estiver instalado no host. Aqui só escrevemos a config
// MCP do primário escolhido, com o `nio` + os MCPs do perfil.

const LABELS: Record<PrimaryClient, string> = { opencode: "OpenCode (global)", codex: "Codex CLI (global)" };

/** Escreve `~/.config/opencode/opencode.json` OU `~/.codex/config.toml` com o
 *  server `nio` + os `profileMcps` do `EnvironmentBuilder`. */
export function installPrimaryClient(primary: PrimaryClient, profileMcps: McpSpec[] = []): void {
  const result: InstallResult =
    primary === "codex" ? installCodexGlobal(profileMcps) : installOpencodeGlobal(profileMcps);
  printInstallResult(LABELS[primary], result);
}
