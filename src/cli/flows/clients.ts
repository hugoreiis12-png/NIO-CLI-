import { spawnSync } from "node:child_process";
import { confirm, select } from "../../lib/prompts.js";
import { CLIENTS, isBinaryInstalled, type ClientInfo } from "../../lib/client-install.js";
import {
  detectPrimaryClient,
  PRIMARY_PRIORITY,
  type PrimaryClient,
} from "../../lib/primary-client.js";
import { readUserConfig, writeUserConfig } from "../../config.js";
import { c, sym, cmd, link, box } from "../../lib/colors.js";
import { flowsCopy, fmt } from "../copy.js";

/**
 * Resolve o **cliente de IA primário** do `nio init` (Parte A):
 * - detecta OpenCode/Codex no PATH (hint do `nio.user.json`, override
 *   `NIO_PRIMARY_CLIENT`);
 * - **ambos** instalados sem escolha travada → pergunta e persiste;
 * - **um** → usa;
 * - **nenhum** → oferece instalar (default OpenCode, linhagem big-pickle) e
 *   re-detecta.
 * Retorna o primário, ou `null` se nada foi instalado e o usuário recusou.
 */
export async function resolvePrimaryClient(opts: {
  interactive: boolean;
  assumeYes?: boolean;
}): Promise<PrimaryClient | null> {
  const hint = readUserConfig().primaryClient;
  let det = detectPrimaryClient(hint);

  if (det.installed.length > 1 && !hint && !process.env.NIO_PRIMARY_CLIENT && opts.interactive) {
    const picked = await select<PrimaryClient>({
      message: "OpenCode e Codex detectados — qual usar como cliente principal?",
      choices: det.installed.map((id) => ({ name: CLIENTS[id]!.label, value: id })),
    });
    writeUserConfig({ primaryClient: picked });
    console.log(`  ${c.green(sym.ok)} ${c.bold(CLIENTS[picked]!.label)} ${c.dim("como principal (nio.user.json).")}`);
    return picked;
  }

  if (det.chosen) {
    console.log(
      `  ${c.green(sym.ok)} ${c.bold(CLIENTS[det.chosen]!.label)} ${c.dim("detectado como cliente principal.")}`,
    );
    return det.chosen;
  }

  console.log(`  ${c.yellow(sym.warn)} Nenhum cliente de IA (OpenCode/Codex) no PATH.`);
  let toInstall: PrimaryClient = "opencode";
  if (opts.interactive) {
    toInstall = await select<PrimaryClient>({
      message: "Instalar qual cliente de IA?",
      choices: PRIMARY_PRIORITY.map((id) => ({ name: CLIENTS[id]!.label, value: id })),
    });
  }
  await ensureClientInstalled(CLIENTS[toInstall]!, opts);

  det = detectPrimaryClient(toInstall);
  if (det.chosen) {
    writeUserConfig({ primaryClient: det.chosen });
    return det.chosen;
  }
  return null;
}

/** Checa o cliente e, se ausente, orienta: oferece `npm i -g <pkg>` (CLIs) ou mostra o link (apps). */
export async function ensureClientInstalled(
  info: ClientInfo,
  opts: { interactive: boolean; assumeYes?: boolean },
): Promise<void> {
  if (info.binary && isBinaryInstalled(info.binary)) {
    console.log(
      `  ${c.green(sym.ok)} ${c.bold(info.label)} ${c.dim("detectado no PATH.")}`,
    );
    return;
  }

  if (info.npm) {
    const installCmd = `npm install -g ${info.npm}`;
    console.log(
      box(
        `${c.yellow(sym.warn)} ${c.bold(info.label)} ${c.dim("não encontrado.")}\n` +
          `${c.dim("instalar:")}  ${cmd(installCmd)}\n` +
          `${c.dim("docs:")}     ${link(info.url)}`,
        { borderColor: "yellow", title: info.label },
      ),
    );
    const run =
      opts.assumeYes === true ||
      (opts.interactive &&
        (await confirm({
          message: fmt(flowsCopy.installClient, { label: info.label }),
          default: false,
        })));
    if (run) {
      const res = spawnSync("npm", ["install", "-g", info.npm], {
        stdio: "inherit",
      });
      console.log(
        res.status === 0
          ? `  ${c.green(`${sym.ok} ${info.label} instalado`)}`
          : `  ${c.red(`${sym.err} falha ao instalar — rode manualmente: `)}${cmd(installCmd)}`,
      );
    }
    return;
  }

  // App sem instalador via CLI — só orienta o download.
  console.log(
    box(
      `${c.yellow(sym.warn)} ${c.bold("Instale o " + info.label)}\n` +
        `${c.dim("download:")} ${link(info.url)}\n` +
        `${c.dim("depois, reabra o app pra carregar a extensão/MCP.")}`,
      { borderColor: "yellow", title: info.label },
    ),
  );
}
