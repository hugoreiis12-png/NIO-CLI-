import { loadSession, type StoredSession } from "../../../lib/auth/session-store.js";
import { brand } from "../../../brand.js";
import { box, c, sym, cmd } from "../../../lib/colors.js";

/**
 * O `nio init` v2 exige login prévio (`nio register` + `nio login`, JWT via
 * nio-gateway) — diferente do v1, que tinha um fluxo de auth pausado e caía
 * num setup local sem vínculo. Aqui não há login inline: se não há sessão
 * local válida em `~/.nio/session.json`, orienta e sai do processo.
 */
export async function requireLocalSessionStep(): Promise<StoredSession> {
  const session = await loadSession();
  if (session) return session;

  console.log(
    box(
      `${c.yellow(sym.warn)} ${c.bold("Você ainda não está autenticado.")}\n` +
        `${c.dim("crie um usuário:")} ${cmd(`${brand.name} register`)}\n` +
        `${c.dim("depois entre com:")} ${cmd(`${brand.name} login`)}\n` +
        `${c.dim("ou seja conduzido:")} ${cmd(`${brand.name} start`)}`,
      { borderColor: "yellow", title: "Autenticação necessária" },
    ),
  );
  process.exit(1);
}
