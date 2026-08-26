// Sessions CLI: lista, ativa, pausa, deleta. Não cria nem edita (isso é feito pelo nio init)
import type { Command } from "commander";
import { loadSession } from "../../lib/session-store.js";
import { createSessionRepository } from "../../adapters/pg/session-repository.js";
import type { SessionRepository } from "../../core/repositories.js";
import type { Session } from "../../core/session.js";
import { confirm } from "../../lib/prompts.js";
import { section, c, sym } from "../../lib/colors.js";
import { brand } from "../../brand.js";

/**
 * `nio sessions` — gerencia as sessões de ambiente (a `Session` v2 no Postgres).
 * O backend (`SessionRepository`) já tem o CRUD + invariante de 1-ativa-por-usuário;
 * aqui é só a superfície de CLI.
 */

/** Match por prefixo de UUID (o usuário não digita o id inteiro). Pura, testável. */
export function matchByIdPrefix(sessions: Session[], prefix: string): Session[] {
  return sessions.filter((s) => s.id.startsWith(prefix));
}

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

/** Resolve uma sessão pelo prefixo do id; erro claro se ausente/ambíguo. */
async function resolve(repo: SessionRepository, userId: number, prefix: string): Promise<Session | null> {
  const all = await repo.listByUser(userId);
  const matches = matchByIdPrefix(all, prefix);
  if (matches.length === 1) return matches[0]!;
  if (matches.length === 0) {
    console.error(`${c.red(sym.err)} Nenhuma sessão começa com "${prefix}". Veja ${c.cyan(`${brand.name} sessions`)}.`);
  } else {
    console.error(`${c.red(sym.err)} Ambíguo: ${matches.length} sessões começam com "${prefix}". Use mais caracteres.`);
  }
  return null;
}

async function withRepo<T>(fn: (repo: SessionRepository, userId: number) => Promise<T>): Promise<void> {
  const userId = await requireUserId();
  try {
    await fn(createSessionRepository(), userId);
  } catch (err) {
    console.error(`${c.red(sym.err)} Falha no banco: ${(err as Error).message}`);
    process.exit(1);
  }
}

async function list(): Promise<void> {
  await withRepo(async (repo, userId) => {
    const sessions = await repo.listByUser(userId);
    if (sessions.length === 0) {
      console.log(`Nenhuma sessão ainda. Rode ${c.cyan(`${brand.name} init`)} pra criar uma.`);
      return;
    }
    section("Sessões", `${sessions.length} do usuário (id abreviado · nome · perfil · status)`);
    for (const s of sessions) printRow(s);
  });
}

export function registerSessionsCommand(program: Command): void {
  const cmd = program.command("sessions").description("Gerencia as sessões de ambiente (list/activate/pause/delete)");

  cmd.command("list", { isDefault: true }).description("Lista as suas sessões").action(list);

  cmd
    .command("activate <id>")
    .description("Ativa uma sessão (arquiva as demais ativas)")
    .action(async (id: string) => {
      await withRepo(async (repo, userId) => {
        const s = await resolve(repo, userId, id);
        if (!s) process.exit(1);
        const updated = await repo.activate(s.id, userId);
        if (!updated) {
          console.error(`${c.red(sym.err)} Não consegui ativar "${s.name}".`);
          process.exit(1);
        }
        console.log(`${c.green(sym.ok)} Sessão ${c.bold(s.name)} agora está ${c.green("ativa")}.`);
      });
    });

  cmd
    .command("pause <id>")
    .description("Pausa uma sessão")
    .action(async (id: string) => {
      await withRepo(async (repo, userId) => {
        const s = await resolve(repo, userId, id);
        if (!s) process.exit(1);
        await repo.setStatus(s.id, "paused");
        console.log(`${c.yellow(sym.ok)} Sessão ${c.bold(s.name)} ${c.yellow("pausada")}.`);
      });
    });

  cmd
    .command("delete <id>")
    .description("Remove uma sessão (irreversível)")
    .action(async (id: string) => {
      await withRepo(async (repo, userId) => {
        const s = await resolve(repo, userId, id);
        if (!s) process.exit(1);
        const ok = await confirm({ message: `Remover a sessão "${s.name}" (${s.profile})? Irreversível.`, default: false });
        if (!ok) {
          console.log("Cancelado.");
          return;
        }
        await repo.delete(s.id);
        console.log(`${c.green(sym.ok)} Sessão ${c.bold(s.name)} removida.`);
      });
    });
}
