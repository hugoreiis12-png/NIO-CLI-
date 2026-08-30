import type { Command } from "commander";
import { input, password } from "../../lib/prompts.js";
import { brand } from "../../brand.js";
import { animateMatrixLogo } from "../../matrix-logo.js";
import { startSpinner } from "../../lib/spinner.js";
import { c, sym } from "../../lib/colors.js";
import { createUserRepository } from "../../adapters/pg/user-repository.js";
import {
  gatewayLogin,
  gatewayLogout,
  gatewayVerify2fa,
  type GatewaySession,
} from "../../lib/auth/gateway-client.js";
import { loadSession, saveSession, clearSession } from "../../lib/auth/session-store.js";
import { ensureConfig } from "../../lib/auth/nio-config.js";
import { authCopy } from "../copy.js";

/**
 * 2º fator: o `/login` respondeu `2fa_required`. Pede o código (SMS), até 3 vezes;
 * se as tentativas de OTP esgotam, troca pro prompt de código de backup.
 * Retorna a sessão emitida, ou `null` (usuário desistiu / esgotou).
 */
async function resolveSecondFactor(
  challengeId: string,
  phoneHint: string,
): Promise<GatewaySession | null> {
  console.log(`  ${c.dim(`código enviado por SMS para ${phoneHint}`)}`);
  let type: "otp" | "backup" = "otp";
  for (let attempt = 0; attempt < 4; attempt++) {
    const code = (
      await input({
        message: type === "otp" ? "Código de confirmação (SMS)" : "Código de backup",
        validate: (v) => v.trim().length > 0 || "obrigatório",
      })
    ).trim();
    const res = await gatewayVerify2fa(challengeId, code, type);
    if (res.ok) return res;
    if (res.requiresBackupCode) {
      console.log(`  ${c.yellow(sym.warn)} tentativas de SMS esgotadas — use um código de backup.`);
      type = "backup";
      continue;
    }
    const left = res.remaining !== undefined ? ` (${res.remaining} tentativa(s))` : "";
    console.log(`  ${c.red(sym.err)} código incorreto${left}.`);
  }
  return null;
}

const MIN_PASSWORD_LENGTH = 8;

/** Fluxo completo de login: config → prompt nome/senha → gateway (+2FA) → salva a sessão. */
async function runLogin(): Promise<void> {
  await ensureConfig({ interactive: true });
  const name = await input({ message: authCopy.login.namePrompt });
  const pass = await password({ message: authCopy.login.passwordPrompt, mask: "*" });

  const spinner = startSpinner("Autenticando...");
  let session: GatewaySession;
  try {
    const result = await gatewayLogin(name.trim(), pass);
    if (!result) {
      spinner.fail(authCopy.login.invalidCredentials);
      process.exit(1);
    }
    spinner.stop();

    if (result.step === "done") {
      session = result;
    } else {
      const s = await resolveSecondFactor(result.challengeId, result.phoneHint);
      if (!s) {
        console.error(`${c.red(sym.err)} 2º fator não concluído.`);
        process.exit(1);
      }
      session = s;
    }
  } catch (err) {
    spinner.fail(`Falha ao autenticar: ${(err as Error).message}`);
    process.exit(1);
  }

  await saveSession({
    userId: session.userId,
    name: session.name,
    token: session.token,
    sessionId: session.sessionId,
    loggedInAt: new Date().toISOString(),
    expiresAt: session.expiresAt,
  });
  await animateMatrixLogo();
  console.log("[ok] Autenticado!");
  console.log(`Usuário: ${session.name}`);
  console.log(`ID:      ${session.userId}`);
}

function registerRegisterCommand(program: Command): void {
  program
    .command("register")
    .description("Cria um novo usuário no banco (user_cli) e já entra (login)")
    .action(async () => {
      await ensureConfig({ interactive: true });
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
        console.log(`${c.green(sym.ok)} Usuário criado: ${user.name} (id ${user.id})`);
      } catch (err) {
        spinner.fail(`Falha ao criar usuário: ${(err as Error).message}`);
        process.exit(1);
      }

      console.log(c.dim("\nVamos entrar:"));
      await runLogin();
    });
}

function registerLoginCommand(program: Command): void {
  program
    .command("login")
    .description("Autentica via nio-gateway (túnel HTTP) e salva a sessão localmente (JWT)")
    .action(runLogin);
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
          // gateway fora do ar — ainda assim limpamos a sessão local.
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
      await animateMatrixLogo();
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
