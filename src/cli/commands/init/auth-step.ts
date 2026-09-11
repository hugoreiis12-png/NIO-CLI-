import { loadSession, type StoredSession } from "../../../lib/auth/session-store.js";
import { createUserRepository } from "../../../adapters/pg/user-repository.js";
import { brand } from "../../../brand.js";
import { box, c, sym, cmd } from "../../../lib/colors.js";

/**
 * O `nio init` v2 exige login prévio (`nio register` + `nio login`, JWT via
 * nio-gateway) — diferente do v1, que tinha um fluxo de auth pausado e caía
 * num setup local sem vínculo. Aqui não há login inline: se não há sessão
 * local válida em `~/.nio/session.json`, orienta e sai do processo.
 *
 * "Válida" = arquivo presente E não expirada E usuário ainda existe no banco.
 * Só checar o arquivo deixava sessão fantasma (ex.: banco resetado) passar e
 * explodir depois no INSERT com erro cru de FK (`sessions_user_id_fkey`).
 */
export async function requireLocalSessionStep(): Promise<StoredSession> {
  const session = await loadSession();
  if (!session)
    return needAuthBox("Você ainda não está autenticado.", { suggestRegister: true });

  if (Number.isFinite(Date.parse(session.expiresAt)) && new Date(session.expiresAt) <= new Date()) {
    return needAuthBox("Sua sessão local expirou.");
  }

  let userExists = false;
  try {
    userExists = (await createUserRepository().findById(session.userId)) !== null;
  } catch {
    // Banco inacessível aqui não é veredito — o `ensureConfig` do init já
    // validou a conexão; segue com o arquivo e deixa o INSERT falar.
    return session;
  }
  if (!userExists) {
    return needAuthBox(
      `O usuário da sessão local (id ${session.userId}) não existe mais no banco.`,
    );
  }
  return session;
}

function needAuthBox(reason: string, opts: { suggestRegister?: boolean } = {}): never {
  console.log(
    box(
      `${c.yellow(sym.warn)} ${c.bold(reason)}\n` +
        (opts.suggestRegister ? `${c.dim("crie um usuário:")} ${cmd(`${brand.name} register`)}\n` : "") +
        `${c.dim("entre de novo:")} ${cmd(`${brand.name} login`)}\n` +
        `${c.dim("ou seja conduzido:")} ${cmd(`${brand.name} start`)}`,
      { borderColor: "yellow", title: "Autenticação necessária" },
    ),
  );
  process.exit(1);
}
