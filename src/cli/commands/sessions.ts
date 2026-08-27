// Sessions CLI: lista, ativa, pausa, deleta. Não cria nem edita (isso é o `nio init`).
// Superfície fina sobre o `SessionManager` (app layer) — a lógica de resolução por
// prefixo de UUID e a invariante 1-ativa-por-usuário vivem lá.
import type { Command } from "commander";
import { loadSession } from "../../lib/session-store.js";
import {
  SessionManager,
  SessionNotFoundError,
  AmbiguousSessionError,
} from "../../app/session-manager.js";
import type { Session, SessionStatus } from "../../core/session.js";
import { confirm } from "../../lib/prompts.js";
import { section, c, sym } from "../../lib/colors.js";
import { brand } from "../../brand.js";

const STATUS_STYLE: Record<string, (t: string) => string> = {
  active: c.green,
  paused: c.yellow,
  archived: c.dim,
};

async function requireUserId(): Promise<number> {
  const stored = await loadSession();
  if (!stored) {
    console.error(`${c.yellow(sym.warn)} Não autenticado. Rode ${c.cyan(`${brand.name} login`)}.`);
    process.exit(1);
  }
  return stored.userId;
}

function printRow(s: Session): void {
  const style = STATUS_STYLE[s.status] ?? c.dim;
  const active = s.status === "active" ? c.green(`  ${sym.dot} ativa`) : "";
  console.log(
    `  ${c.dim(s.id.slice(0, 8))}  ${s.name.padEnd(22)} ${c.dim(s.profile.padEnd(10))} ${style(s.status)}${active}`,
  );
}

/** Roda `fn` com o manager + userId; erros de resolução e de banco viram mensagem + exit 1. */
async function withManager(fn: (m: SessionManager, userId: number) => Promise<void>): Promise<void> {
  const userId = await requireUserId();
  try {
    await fn(new SessionManager(), userId);
  } catch (err) {
    if (err instanceof SessionNotFoundError || err instanceof AmbiguousSessionError) {
      console.error(`${c.red(sym.err)} ${err.message} Veja ${c.cyan(`${brand.name} sessions`)}.`);
    } else {
      console.error(`${c.red(sym.err)} Falha no banco: ${(err as Error).message}`);
    }
    process.exit(1);
  }
}

async function list(): Promise<void> {
  await withManager(async (m, userId) => {
    const sessions = await m.list(userId);
    if (sessions.length === 0) {
      console.log(`Nenhuma sessão ainda. Rode ${c.cyan(`${brand.name} init`)} pra criar uma.`);
      return;
    }
    section("Sessões", `${sessions.length} do usuário (id abreviado · nome · perfil · status)`);
    for (const s of sessions) printRow(s);
  });
}

async function changeStatus(id: string, status: Exclude<SessionStatus, "active">, label: string): Promise<void> {
  await withManager(async (m, userId) => {
    const s = await m.setStatus(userId, id, status);
    console.log(`${c.yellow(sym.ok)} Sessão ${c.bold(s.name)} ${c.yellow(label)}.`);
  });
}

export function registerSessionsCommand(program: Command): void {
  const cmd = program.command("sessions").description("Gerencia as sessões de ambiente (list/activate/pause/delete)");

  cmd.command("list", { isDefault: true }).description("Lista as suas sessões").action(list);

  cmd
    .command("activate <id>")
    .description("Ativa uma sessão (arquiva as demais ativas)")
    .action(async (id: string) => {
      await withManager(async (m, userId) => {
        const s = await m.activate(userId, id);
        console.log(`${c.green(sym.ok)} Sessão ${c.bold(s.name)} agora está ${c.green("ativa")}.`);
      });
    });

  cmd
    .command("pause <id>")
    .description("Pausa uma sessão")
    .action((id: string) => changeStatus(id, "paused", "pausada"));

  cmd
    .command("delete <id>")
    .description("Remove uma sessão (irreversível)")
    .action(async (id: string) => {
      await withManager(async (m, userId) => {
        const s = await m.resolve(userId, id);
        const ok = await confirm({
          message: `Remover a sessão "${s.name}" (${s.profile})? Irreversível.`,
          default: false,
        });
        if (!ok) {
          console.log("Cancelado.");
          return;
        }
        await m.delete(userId, s.id);
        console.log(`${c.green(sym.ok)} Sessão ${c.bold(s.name)} removida.`);
      });
    });
}
