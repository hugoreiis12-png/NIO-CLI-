import { spawnSync } from "node:child_process";
import { confirm } from "../../lib/prompts.js";
import { CLIENTS, isBinaryInstalled, type ClientInfo } from "../../lib/client-install.js";
import { c, sym, cmd, link, box } from "../../lib/colors.js";
import { flowsCopy, fmt } from "../copy.js";

/**
 * Verificação inicial do `init`: confere se o **OpenCode** está instalado e,
 * se faltar, oferece instalar via `npm i -g` [y/N] (com o comando + docs à
 * mostra). Best-effort; nunca bloqueia o init.
 *
 * Claude Code/Codex/VS Code/Cowork saíram da superfície ativa (decisão de
 * 2026-07-27) — o motor de config deles continua em `client-configs.ts`,
 * não apagado.
 */
export async function ensureCoreClients(opts: {
  interactive: boolean;
  assumeYes?: boolean;
}): Promise<void> {
  await ensureClientInstalled(CLIENTS.opencode, opts);
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
