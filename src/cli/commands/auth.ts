import type { Command } from "commander";
import { password } from "../../lib/prompts.js";
import { brand } from "../../brand.js";
import { renderMatrixLogo } from "../../matrix-logo.js";
import { startSpinner } from "../../spinner.js";
import {
  clearCredentials,
  exchangePatForJwt,
  loadCredentials,
  resolveIdentity,
  saveCredentials,
  validatePatFormat,
  type CachedUser,
  type Credentials,
  type ExchangeResult,
  type Identity,
} from "../../auth.js";
import { authCopy } from "../copy.js";

/** Obtém o PAT: usa o argumento se veio preenchido, senão pede via prompt mascarado. */
async function resolvePat(patArg?: string): Promise<string> {
  const trimmed = patArg?.trim();
  if (trimmed) return trimmed;

  if (brand.webUrl) console.log(`Gere um token pessoal em: ${brand.webUrl}/profile#mcp`);
  const answer = await password({
    message: authCopy.login.patPrompt,
    mask: "*",
    validate: (input) =>
      validatePatFormat(input.trim()) || authCopy.login.patInvalid,
  });
  return answer.trim();
}

/** Troca o PAT por sessão e persiste as credenciais localmente. */
async function performLogin(pat: string): Promise<ExchangeResult> {
  const result = await exchangePatForJwt(pat);
  await saveCredentials({
    pat,
    user: result.user,
    fetched_at: new Date().toISOString(),
  });
  return result;
}

function printLoginSuccess(u: CachedUser): void {
  console.log(renderMatrixLogo());
  console.log("[ok] Autenticado!");
  console.log(`Nome:    ${u.full_name || "(sem nome)"}`);
  console.log(
    `Usuário: ${u.username ? `@${u.username}` : "(sem username)"}`,
  );
  console.log(`Email:   ${u.email}`);
}

/** Decide se dá pra pular o spinner de validação: só quando a sessão já está em
 * cache (usuário + data de fetch salvos) e o caller não pediu revalidação forçada. */
export function shouldSkipWhoamiSpinner(
  creds: Credentials,
  refresh?: boolean,
): boolean {
  return !refresh && Boolean(creds.user && creds.fetched_at);
}

/** Traduz o erro de `resolveIdentity` pra mensagem exibida ao usuário. */
export function whoamiErrorMessage(err: unknown): string {
  const status = (err as { status?: number }).status;
  return status === 401 || status === 403
    ? `Sessão inválida. Rode \`${brand.name} login <PAT>\` novamente.`
    : `Falha ao validar token: ${(err as Error).message}`;
}

function printWhoamiIdentity(u: Identity): void {
  console.log(renderMatrixLogo());
  console.log(`Nome:    ${u.full_name || "(sem nome)"}`);
  console.log(`Email:   ${u.email}`);
  console.log(
    `Usuário: ${u.username ? `@${u.username}` : "(sem username)"}`,
  );
  console.log(`ID:      ${u.id}`);
}

function registerLoginCommand(program: Command): void {
  program
    .command("login")
    .description("Salva o token de acesso pessoal (PAT) localmente")
    .argument(
      "[pat]",
      "Token gerado em /profile#mcp do NOS (opcional — será pedido se omitido)",
    )
    .action(async (patArg?: string) => {
      const pat = await resolvePat(patArg);

      if (!validatePatFormat(pat)) {
        console.error(
          `Token inválido. Formato esperado: \`${brand.patPrefix}\` + 64 caracteres hexadecimais.`,
        );
        process.exit(1);
      }

      const spinner = startSpinner("Autenticando...");
      try {
        const result = await performLogin(pat);
        spinner.stop();
        printLoginSuccess(result.user);
      } catch (err) {
        spinner.fail(`Falha ao autenticar: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}

function registerLogoutCommand(program: Command): void {
  program
    .command("logout")
    .description("Remove credenciais locais")
    .action(async () => {
      await clearCredentials();
      console.log("Sessão removida.");
    });
}

async function runWhoamiAction(opts: {
  json?: boolean;
  refresh?: boolean;
}): Promise<void> {
  const creds = await loadCredentials();
  if (!creds) {
    console.error(`Não autenticado. Rode \`${brand.name} login <PAT>\`.`);
    process.exit(1);
  }

  const cached = shouldSkipWhoamiSpinner(creds, opts.refresh);
  const spinner =
    cached || opts.json ? null : startSpinner("Validando sessão...");
  try {
    const u = await resolveIdentity(creds, { refresh: opts.refresh });
    spinner?.stop();
    if (opts.json) {
      console.log(JSON.stringify(u, null, 2));
      return;
    }
    printWhoamiIdentity(u);
  } catch (err) {
    const message = whoamiErrorMessage(err);
    if (spinner) spinner.fail(message);
    else console.error(message);
    process.exit(1);
  }
}

function registerWhoamiCommand(program: Command): void {
  program
    .command("whoami")
    .description("Mostra o usuário autenticado")
    .option("--json", "Emite a identidade como JSON")
    .option("--refresh", "Ignora o cache e revalida o token")
    .action(runWhoamiAction);
}

export function registerAuthCommands(program: Command): void {
  registerLoginCommand(program);
  registerLogoutCommand(program);
  registerWhoamiCommand(program);
}
