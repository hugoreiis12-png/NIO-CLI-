import { checkbox } from "../../../lib/prompts.js";
import { section } from "../../../lib/colors.js";
import { CLIENTS } from "../../../lib/clients/client-install.js";
import { installOpencodeGlobal, type InstallResult } from "../../../lib/clients/client-configs.js";
import { printInstallResult } from "../../ui/render.js";
import { ensureClientInstalled } from "../../flows/clients.js";
import { initCopy } from "../../copy.js";
import type { McpSpec } from "../../../core/environment.js";

// Só OpenCode por enquanto (decisão de 2026-07-27) — os outros clientes saem
// da superfície ativa, mas o motor de config deles continua em
// client-configs.ts, não apagado.
export type ClientChoice = "opencode-global";

export type ChosenClientId = "opencode";

export const CLIENT_INSTALLERS: Record<
  ClientChoice,
  { label: string; run: (cwd: string, profileMcps: McpSpec[]) => InstallResult }
> = {
  "opencode-global": {
    label: "OpenCode (global)",
    run: (_cwd, profileMcps) => installOpencodeGlobal(profileMcps),
  },
};

export async function promptClientChoices(): Promise<ClientChoice[]> {
  return checkbox<ClientChoice>({
    message: initCopy.clientsPrompt,
    all: true,
    choices: [{ name: initCopy.clientChoices.opencodeGlobal, value: "opencode-global" }],
  });
}

/** Roda a instalação de cada cliente escolhido, com os MCPs do perfil. */
export function installClients(
  clientConfigs: ClientChoice[],
  cwd: string,
  profileMcps: McpSpec[] = [],
): void {
  for (const choice of clientConfigs) {
    const installer = CLIENT_INSTALLERS[choice];
    try {
      printInstallResult(installer.label, installer.run(cwd, profileMcps));
    } catch (err) {
      console.error(`[erro] Falha ao configurar ${choice}: ${(err as Error).message}`);
    }
  }
}

/**
 * Dado o resultado do checkbox de clientes, quais IDs (`CLIENTS[id]`) devem
 * ser conferidos como instalados.
 */
export function resolveChosenClientIds(clientConfigs: ClientChoice[]): Set<ChosenClientId> {
  const ids = new Set<ChosenClientId>();
  for (const choice of clientConfigs) {
    if (choice === "opencode-global") ids.add("opencode");
  }
  return ids;
}

export async function ensureChosenClientsInstalled(
  chosenClientIds: Set<ChosenClientId>,
): Promise<void> {
  if (chosenClientIds.size === 0) return;
  console.log("");
  section("Clientes", "confirmando que estão instalados");
  for (const id of chosenClientIds) {
    await ensureClientInstalled(CLIENTS[id], { interactive: true });
  }
}
