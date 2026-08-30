/**
 * `nio security` — gerência do 2º fator (SMS OTP + códigos de backup) pelo
 * usuário logado. Fala com o `nio-gateway` (`/security/*`, exige o JWT da sessão).
 * Ver `docs/specs/auth/0004-login-2fa-sms-otp.md`.
 */
import type { Command } from "commander";
import { brand } from "../../brand.js";
import { c, sym, section, box } from "../../lib/colors.js";
import { input, password, confirm } from "../../lib/prompts.js";
import { loadSession } from "../../lib/auth/session-store.js";
import { gatewaySecurity } from "../../lib/auth/gateway-client.js";

/** Token da sessão local, ou encerra pedindo login. */
async function requireToken(): Promise<string> {
  const s = await loadSession();
  if (!s) {
    console.error(`${c.yellow(sym.warn)} Não autenticado. Rode ${c.cyan(`${brand.name} login`)}.`);
    process.exit(1);
  }
  return s.token;
}

/** Imprime os 10 códigos de backup num box com o aviso. */
function printBackupCodes(codes: string[]): void {
  console.log(
    box(
      [
        `${c.yellow(sym.warn)} ${c.bold("GUARDE ESTES CÓDIGOS EM LOCAL SEGURO")}`,
        "",
        ...codes.map((code, i) => `  ${String(i + 1).padStart(2, "0")}. ${c.bold(code)}`),
        "",
        "Cada código serve UMA vez. Use-os se o SMS não chegar no login.",
        `Regenerar: ${brand.name} security regenerate-backup-codes`,
      ].join("\n"),
      { borderColor: "yellow", title: "códigos de backup" },
    ),
  );
}

async function runEnable(): Promise<void> {
  const token = await requireToken();
  section("2º fator", "ativar (SMS)");

  const st = await gatewaySecurity.status(token).catch((e) => {
    console.error(`${c.red(sym.err)} ${(e as Error).message}`);
    process.exit(1);
  });
  if (st.enabled) {
    console.log(`${c.yellow(sym.warn)} 2FA já está ativo (${st.phoneHint}). Use \`disable-2fa\` pra trocar.`);
    return;
  }

  const phone = (
    await input({
      message: "Número de celular (E.164, ex.: +5511999998888)",
      validate: (v) => /^\+\d{8,15}$/.test(v.trim()) || "use o formato E.164: +55DDDNNNNNNNNN",
    })
  ).trim();

  let challengeId: string;
  try {
    ({ challengeId } = await gatewaySecurity.enable(token, phone));
  } catch (err) {
    console.error(`${c.red(sym.err)} ${(err as Error).message}`);
    process.exit(1);
  }
  console.log(`  ${c.dim(`SMS enviado para ${phone}`)}`);

  const code = (await input({ message: "Código recebido por SMS", validate: (v) => v.trim().length > 0 || "obrigatório" })).trim();
  try {
    const { backupCodes } = await gatewaySecurity.confirmEnable(token, challengeId, code, phone);
    console.log(`${c.green(sym.ok)} 2º fator ativado.`);
    printBackupCodes(backupCodes);
  } catch (err) {
    console.error(`${c.red(sym.err)} ${(err as Error).message}`);
    process.exit(1);
  }
}

/** Dispara o SMS pro número registrado e devolve o challengeId + código digitado. */
async function challengeAndCode(token: string): Promise<{ challengeId: string; code: string; type: "otp" | "backup" }> {
  let challengeId: string;
  try {
    ({ challengeId } = await gatewaySecurity.challenge(token));
  } catch (err) {
    console.error(`${c.red(sym.err)} ${(err as Error).message}`);
    process.exit(1);
  }
  console.log(`  ${c.dim("SMS enviado para o número registrado.")}`);
  const useBackup = !(await confirm({ message: "Recebeu o SMS?", default: true }));
  const code = (
    await input({
      message: useBackup ? "Código de backup" : "Código recebido por SMS",
      validate: (v) => v.trim().length > 0 || "obrigatório",
    })
  ).trim();
  return { challengeId, code, type: useBackup ? "backup" : "otp" };
}

async function runDisable(): Promise<void> {
  const token = await requireToken();
  section("2º fator", "desativar");
  const st = await gatewaySecurity.status(token);
  if (!st.enabled) {
    console.log(`${c.dim("2FA já está desativado.")}`);
    return;
  }
  await password({ message: "Sua senha (confirmação)", mask: "*" }); // prova de presença; o gateway valida o código
  const { challengeId, code, type } = await challengeAndCode(token);
  try {
    await gatewaySecurity.disable(token, challengeId, code, type);
    console.log(`${c.green(sym.ok)} 2º fator desativado.`);
  } catch (err) {
    console.error(`${c.red(sym.err)} ${(err as Error).message}`);
    process.exit(1);
  }
}

async function runRegenerate(): Promise<void> {
  const token = await requireToken();
  section("2º fator", "regenerar códigos de backup");
  const { challengeId, code, type } = await challengeAndCode(token);
  try {
    const { backupCodes } = await gatewaySecurity.regenerateBackupCodes(token, challengeId, code, type);
    console.log(`${c.green(sym.ok)} códigos antigos invalidados.`);
    printBackupCodes(backupCodes);
  } catch (err) {
    console.error(`${c.red(sym.err)} ${(err as Error).message}`);
    process.exit(1);
  }
}

async function runStatus(opts: { json?: boolean }): Promise<void> {
  const token = await requireToken();
  let st;
  try {
    st = await gatewaySecurity.status(token);
  } catch (err) {
    console.error(`${c.red(sym.err)} ${(err as Error).message}`);
    process.exit(1);
  }
  if (opts.json) {
    console.log(JSON.stringify(st, null, 2));
    return;
  }
  console.log(`2º fator: ${st.enabled ? c.green("ativo") : c.dim("inativo")}`);
  if (st.enabled) {
    console.log(`número:   ${st.phoneHint}`);
    console.log(`backup:   ${st.backupCodesRemaining} código(s) restante(s)`);
  }
}

export function registerSecurityCommands(program: Command): void {
  const cmd = program.command("security").description("2º fator do login (SMS OTP + códigos de backup)");

  cmd.command("enable-2fa").description("Ativa o 2º fator via SMS").action(runEnable);
  cmd.command("disable-2fa").description("Desativa o 2º fator").action(runDisable);
  cmd
    .command("regenerate-backup-codes")
    .description("Invalida os códigos de backup e gera 10 novos")
    .action(runRegenerate);
  cmd
    .command("status", { isDefault: true })
    .description("Mostra o estado do 2º fator")
    .option("--json", "saída em JSON")
    .action(runStatus);
}
