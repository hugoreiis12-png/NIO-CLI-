import type { Command } from "commander";
import { input, password } from "../../lib/prompts.js";
import { brand } from "../../brand.js";
import { renderMatrixLogo } from "../../matrix-logo.js";
import { startSpinner } from "../../spinner.js";
import { createUserRepository } from "../../adapters/pg/user-repository.js";
import { login as gatewayLogin, logout as gatewayLogout } from "../../gateway/services/login.js";
import { loadSession, saveSession, clearSession } from "../../lib/session-store.js";
import { authCopy } from "../copy.js";

const MIN_PASSWORD_LENGTH = 8;

function registerRegisterCommand(program: Command): void {
  program
    .command("register")
    .description("Cria um novo usuário no banco (user_cli)")
    .action(async () => {
      const name = await input({
        message: authCopy.register.namePrompt,
        validate: (v) => v.trim().length > 0 || authCopy.register.nameInvalid,
      });
      const pass = await password({
        message: authCopy.register.passwordPrompt,
        mask: "*",
        validate: (v) => v.length >= MIN_PASSWORD_LENGTH || authCopy.register.passwordInvalid,
      });

      const repo = createUserRepository();
      const spinner = startSpinner("Criando usuário...");
      try {
        const existing = await repo.findByName(name.trim());
        if (existing) {
          spinner.fail(`Usuário "${name.trim()}" já existe.`);
          process.exit(1);
        }
        const user = await repo.create({ name: name.trim(), password: pass });
        spinner.stop();
        console.log(renderMatrixLogo());
        console.log(`[ok] Usuário criado: ${user.name} (id ${user.id})`);
        console.log(`Rode \`${brand.name} login\` pra autenticar.`);
      } catch (err) {
        spinner.fail(`Falha ao criar usuário: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}

function registerLoginCommand(program: Command): void {
  program
    .command("login")
    .description("Autentica contra o banco (user_cli) e salva a sessão localmente (JWT)")
    .action(async () => {
      const name = await input({ message: authCopy.login.namePrompt });
      const pass = await password({ message: authCopy.login.passwordPrompt, mask: "*" });

      const spinner = startSpinner("Autenticando...");
      try {
        const result = await gatewayLogin(name.trim(), pass);
        if (!result) {
          spinner.fail(authCopy.login.invalidCredentials);
          process.exit(1);
        }
        await saveSession({
          userId: result.userId,
          name: result.name,
          token: result.token,
          sessionId: result.sessionId,
          loggedInAt: new Date().toISOString(),
          expiresAt: result.expiresAt.toISOString(),
        });
        spinner.stop();
        console.log(renderMatrixLogo());
        console.log("[ok] Autenticado!");
        console.log(`Usuário: ${result.name}`);
        console.log(`ID:      ${result.userId}`);
      } catch (err) {
        spinner.fail(`Falha ao autenticar: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}

function registerLogoutCommand(program: Command): void {
  program
    .command("logout")
    .description("Encerra a sessão local e revoga a auth_session no banco")
    .action(async () => {
      const session = await loadSession();
      if (session) {
        try {
          await gatewayLogout(session.sessionId);
        } catch {
          // banco fora do ar — ainda assim limpamos a sessão local.
        }
      }
      await clearSession();
      console.log("Sessão removida.");
    });
}

function registerWhoamiCommand(program: Command): void {
  program
    .command("whoami")
    .description("Mostra o usuário autenticado")
    .option("--json", "Emite a identidade como JSON")
    .action(async (opts: { json?: boolean }) => {
      const session = await loadSession();
      if (!session) {
        console.error(`Não autenticado. Rode \`${brand.name} login\`.`);
        process.exit(1);
      }
      if (opts.json) {
        console.log(JSON.stringify(session, null, 2));
        return;
      }
      console.log(renderMatrixLogo());
      console.log(`Usuário:   ${session.name}`);
      console.log(`ID:        ${session.userId}`);
      console.log(`Login em:  ${session.loggedInAt}`);
      console.log(`Expira em: ${session.expiresAt}`);
    });
}

export function registerAuthCommands(program: Command): void {
  registerRegisterCommand(program);
  registerLoginCommand(program);
  registerLogoutCommand(program);
  registerWhoamiCommand(program);
}
