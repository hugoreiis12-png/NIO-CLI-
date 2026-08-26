import type { Command } from "commander";
import { existsSync } from "node:fs";
import { getProjectConfigPath, loadProjectConfig } from "../../config.js";
import { loadSession } from "../../lib/session-store.js";
import { ping, closePool } from "../../adapters/pg/client.js";
import { createSessionRepository } from "../../adapters/pg/session-repository.js";
import { isBinaryInstalled } from "../../lib/client-install.js";
import { skillsCached } from "../../lib/skills-cache.js";
import { opencodeGlobalPath } from "../../lib/client-configs.js";
import { section, c, sym } from "../../lib/colors.js";
import { brand } from "../../brand.js";

/**
 * `nio debug` — diagnóstico do ambiente: roda uma bateria de checagens e mostra
 * onde está o problema (✓ ok · ⚠ atenção · ✗ erro), com dica acionável em cada.
 * Não altera nada; só apura.
 */

type Level = "ok" | "warn" | "fail";
interface Check {
  label: string;
  level: Level;
  detail?: string;
  hint?: string;
}

const ICON: Record<Level, string> = {
  ok: c.green(sym.ok),
  warn: c.yellow(sym.warn),
  fail: c.red(sym.err),
};

function print(check: Check): void {
  const detail = check.detail ? c.dim(` — ${check.detail}`) : "";
  console.log(`  ${ICON[check.level]} ${check.label}${detail}`);
  if (check.hint && check.level !== "ok") console.log(`      ${c.dim(check.hint)}`);
}

async function runChecks(): Promise<Check[]> {
  const checks: Check[] = [];

  // 1. Config do projeto (nio.json)
  const cfgPath = getProjectConfigPath();
  if (!existsSync(cfgPath)) {
    checks.push({ label: brand.projectConfigFile, level: "warn", detail: "ausente", hint: `Rode \`${brand.name} init\` neste diretório.` });
  } else {
    try {
      const cfg = loadProjectConfig();
      checks.push({ label: brand.projectConfigFile, level: "ok", detail: cfg?.session_id ? `session ${cfg.session_id.slice(0, 8)}` : "sem session vinculada" });
    } catch (err) {
      checks.push({ label: brand.projectConfigFile, level: "fail", detail: "JSON inválido", hint: (err as Error).message });
    }
  }

  // 2. Login local
  const stored = await loadSession();
  if (!stored) {
    checks.push({ label: "Login local", level: "fail", detail: "sem sessão", hint: `Rode \`${brand.name} login\`.` });
  } else {
    checks.push({ label: "Login local", level: "ok", detail: `${stored.name}` });
  }

  // 3. Postgres
  const dbOk = await ping();
  checks.push(
    dbOk
      ? { label: "Postgres", level: "ok", detail: "conectado" }
      : { label: "Postgres", level: "fail", detail: "sem conexão", hint: "Confira NIO_DATABASE_URL e a rede/VPN." },
  );

  // 4. Sessão de ambiente ativa (só se logado + banco ok)
  if (stored && dbOk) {
    try {
      const active = await createSessionRepository().findActiveByUser(stored.userId);
      checks.push(
        active
          ? { label: "Sessão ativa", level: "ok", detail: `${active.name} (${active.profile})` }
          : { label: "Sessão ativa", level: "warn", detail: "nenhuma", hint: `Rode \`${brand.name} init\` ou \`${brand.name} sessions activate <id>\`.` },
      );
    } catch (err) {
      checks.push({ label: "Sessão ativa", level: "warn", detail: "não consegui checar", hint: (err as Error).message });
    }
  }

  // 5. OpenCode no PATH
  checks.push(
    isBinaryInstalled("opencode")
      ? { label: "OpenCode (operador)", level: "ok", detail: "no PATH" }
      : { label: "OpenCode (operador)", level: "warn", detail: "não encontrado", hint: "Instale o OpenCode pra o handoff do `init` funcionar." },
  );

  // 6. opencode.json
  checks.push(
    existsSync(opencodeGlobalPath())
      ? { label: "opencode.json", level: "ok", detail: "configurado" }
      : { label: "opencode.json", level: "warn", detail: "ausente", hint: `Gerado pelo \`${brand.name} init\`.` },
  );

  // 7. Cache de skills
  checks.push(
    skillsCached()
      ? { label: "Cache de skills", level: "ok" }
      : { label: "Cache de skills", level: "warn", detail: "vazio", hint: `Rode \`${brand.name} sync\`.` },
  );

  return checks;
}

export function registerDebugCommand(program: Command): void {
  program
    .command("debug")
    .description("Diagnostica o ambiente e aponta onde está o problema")
    .action(async () => {
      section("Debug", "checando o ambiente");
      const checks = await runChecks();
      for (const check of checks) print(check);

      const fails = checks.filter((c) => c.level === "fail").length;
      const warns = checks.filter((c) => c.level === "warn").length;
      console.log("");
      if (fails === 0 && warns === 0) {
        console.log(`${c.green(sym.ok)} Tudo certo.`);
      } else {
        console.log(`${fails > 0 ? c.red(`${fails} erro(s)`) : ""}${fails && warns ? " · " : ""}${warns > 0 ? c.yellow(`${warns} aviso(s)`) : ""}`);
      }

      await closePool().catch(() => {});
      if (fails > 0) process.exitCode = 1;
    });
}
