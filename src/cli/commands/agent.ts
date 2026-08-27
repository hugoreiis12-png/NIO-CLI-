// `nio agent` — cliente de IA da CLI. Parte A: só `status` (primário detectado).
// Parte C adiciona `next` / `reset` / `tiers` (ladder de failover).
import type { Command } from "commander";
import { CLIENTS } from "../../lib/client-install.js";
import { detectPrimaryClient, PRIMARY_PRIORITY } from "../../lib/primary-client.js";
import { readUserConfig } from "../../config.js";
import { section, c, sym } from "../../lib/colors.js";
import { brand } from "../../brand.js";

function status(): void {
  const hint = readUserConfig().primaryClient;
  const det = detectPrimaryClient(hint);

  section("Cliente de IA", "cliente primário desta máquina");

  for (const id of PRIMARY_PRIORITY) {
    const on = det.installed.includes(id);
    const icon = on ? c.green(sym.ok) : c.dim(sym.bullet);
    const tag = det.chosen === id ? c.green("  · principal") : "";
    console.log(`  ${icon} ${c.bold(CLIENTS[id]!.label.padEnd(12))} ${on ? c.dim("no PATH") : c.dim("ausente")}${tag}`);
  }

  console.log("");
  if (det.chosen) {
    console.log(`  ${c.dim("`nio init` vai subir:")} ${c.bold(CLIENTS[det.chosen]!.label)}`);
  } else {
    console.log(`  ${c.yellow(sym.warn)} Nenhum instalado — ${c.cyan(`${brand.name} init`)} oferece instalar.`);
  }
  if (hint) console.log(`  ${c.dim(`hint (nio.user.json): ${hint}`)}`);
  if (process.env.NIO_PRIMARY_CLIENT) {
    console.log(`  ${c.dim(`override (NIO_PRIMARY_CLIENT): ${process.env.NIO_PRIMARY_CLIENT}`)}`);
  }
}

export function registerAgentCommand(program: Command): void {
  const cmd = program.command("agent").description("Cliente de IA da CLI (primário / ladder de failover)");
  cmd.command("status", { isDefault: true }).description("Mostra o cliente primário detectado").action(status);
}
