import {
  c,
  sym,
  cmd,
  link,
  badge,
  section,
  highlightInlineCode,
} from "../../lib/colors.js";
import { brand } from "../../brand.js";
import { type InstallResult } from "../../lib/clients/client-configs.js";
import { type ProvisionResult } from "../../lib/provision/provision.js";
import { type HookProvisionResult } from "../../lib/clients/hooks.js";
import { type ResolvedDependency } from "../../lib/deps/dependencies.js";
import { HARNESS_RULES_REL } from "../../lib/clients/harness.js";

export function printInstallResult(label: string, result: InstallResult): void {
  const at = (p: string) => c.dim(p);
  switch (result.status) {
    case "created":
      console.log(
        `  ${c.green(sym.ok)} ${c.bold(label)} ${c.dim("criado")} ${at(result.path)}`,
      );
      break;
    case "updated":
      console.log(
        `  ${c.green(sym.ok)} ${c.bold(label)} ${c.dim("atualizado")} ${at(result.path)}`,
      );
      if (result.backup)
        console.log(`    ${c.dim("backup:")} ${at(result.backup)}`);
      break;
    case "already_configured":
      console.log(
        `  ${c.green(sym.ok)} ${c.bold(label)} ${c.dim("já configurado")} ${at(result.path)}`,
      );
      break;
  }
}

export function provisionTag(action: string): string {
  switch (action) {
    case "create":
      return c.green("+");
    case "update":
      return c.cyan("~");
    case "prune":
      return c.red("-");
    case "skip-conflict":
    case "prune-kept":
      return c.yellow("!");
    case "write-error":
      return c.red(sym.err);
    default:
      return " ";
  }
}

/**
 * Chave de agrupamento de um relPath: uma skill (`skills/<id>/…`) agrupa por sua
 * pasta; o resto (`commands`, `agents`) agrupa pelo kind de topo.
 */
function groupKey(relPath: string): string {
  const parts = relPath.split("/");
  if (parts[0] === "skills" && parts.length >= 3) return `skills/${parts[1]}`;
  return parts[0];
}

/** Ordena arquivos de um grupo: SKILL.md primeiro, depois alfabético. */
function sortInGroup(a: string, b: string): number {
  const aS = a.toLowerCase() === "skill.md";
  const bS = b.toLowerCase() === "skill.md";
  if (aS !== bS) return aS ? -1 : 1;
  return a.localeCompare(b);
}

export function printProvisionResult(result: ProvisionResult): void {
  const changed = result.files.filter((f) => f.action !== "unchanged");

  // Agrupa por skill/kind, preservando os detalhes por arquivo.
  const groups = new Map<string, ProvisionResult["files"]>();
  for (const f of changed) {
    const key = groupKey(f.relPath);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(f);
  }

  const keys = [...groups.keys()].sort();
  for (const key of keys) {
    const files = groups.get(key)!;
    console.log("");
    console.log(`    ${c.dim(`${key}/`)}`);
    files.sort((a, b) =>
      sortInGroup(a.relPath.slice(key.length + 1), b.relPath.slice(key.length + 1)),
    );
    for (const f of files) {
      const name = f.relPath.slice(key.length + 1);
      const isSkill = name.toLowerCase() === "skill.md";
      const label = isSkill ? c.bold(name) : name;
      const detail = f.detail ? ` ${c.dim(`(${f.detail})`)}` : "";
      console.log(`      ${provisionTag(f.action)} ${label}${detail}`);
    }
  }
  if (keys.length > 0) console.log("");

  const count = (a: string) =>
    result.files.filter((f) => f.action === a).length;
  const part = (n: number, label: string, color: (s: string) => string) =>
    n > 0 ? color(`${n} ${label}`) : c.dim(`${n} ${label}`);
  const parts = [
    part(count("create"), "criados", c.green),
    part(count("update"), "atualizados", c.cyan),
    c.dim(`${count("unchanged")} iguais`),
  ];
  if (count("skip-conflict"))
    parts.push(c.yellow(`${count("skip-conflict")} em conflito`));
  if (count("prune")) parts.push(c.red(`${count("prune")} removidos`));
  if (count("prune-kept"))
    parts.push(c.yellow(`${count("prune-kept")} preservados`));
  if (count("write-error"))
    parts.push(c.red(`${count("write-error")} com erro`));

  const prefix = result.dryRun ? c.dim("[dry-run] ") : "";
  const summary =
    result.files.length === 0
      ? c.dim("bundle vazio")
      : parts.join(c.dim(" · "));
  console.log(
    `    ${prefix}${summary} ${c.dim(sym.arrow)} ${c.dim(result.targetDir)}`,
  );

  if (count("skip-conflict") > 0) {
    console.log(
      `    ${c.yellow(sym.warn)} ${c.dim("conflitos preservados — use")} ${cmd(`${brand.name} sync --force`)} ${c.dim("pra sobrescrever.")}`,
    );
  }
  if (count("write-error") > 0) {
    console.log(
      `    ${c.red(sym.err)} ${c.dim("alguns arquivos falharam (symlink de dotfiles quebrado?) — veja o caminho do link.")}`,
    );
  }
  if (
    !result.dryRun &&
    result.files.some((f) => f.action === "create" || f.action === "update")
  ) {
    console.log(
      `    ${c.dim("reinicie o cliente pra carregar os skills/commands novos.")}`,
    );
  }
}

export function printHarnessResult(result: {
  rules: string;
  agents: string;
  claude: string;
}): void {
  const tag = (a: string) =>
    a === "created"
      ? c.green("+")
      : a === "updated"
        ? c.cyan("~")
        : a === "empty"
          ? c.dim("·")
          : c.dim("=");
  const changed =
    result.rules !== "unchanged" ||
    result.agents !== "unchanged" ||
    result.claude !== "unchanged";
  if (!changed) return;
  console.log("");
  console.log(`  ${c.magenta(sym.dot)} ${c.bold("Harness (repo)")}`);
  console.log(`    ${tag(result.rules)} ${HARNESS_RULES_REL} ${c.dim(`(${result.rules})`)}`);
  console.log(`    ${tag(result.agents)} AGENTS.md ${c.dim(`(${result.agents})`)}`);
  console.log(`    ${tag(result.claude)} CLAUDE.md ${c.dim(`(${result.claude})`)}`);
}

export function printHookResult(result: HookProvisionResult): void {
  const prefix = result.dryRun ? c.dim("[dry-run] ") : "";
  if (result.installed.length === 0 && result.prunedScripts.length === 0) {
    console.log(`    ${prefix}${c.dim("nenhum hook aplicável")}`);
    return;
  }
  for (const h of result.installed) {
    const on = h.matcher ? `${h.event}/${h.matcher}` : h.event;
    console.log(
      `    ${c.green("+")} ${c.bold(h.script)} ${c.dim(`(${on})`)}`,
    );
    if (h.description) console.log(`      ${c.dim(h.description)}`);
  }
  for (const p of result.prunedScripts) {
    console.log(`    ${c.red("-")} ${c.dim(p)}`);
  }
  const parts = [
    result.installed.length > 0
      ? c.green(`${result.installed.length} hooks`)
      : c.dim("0 hooks"),
  ];
  if (result.prunedScripts.length > 0)
    parts.push(c.red(`${result.prunedScripts.length} removidos`));
  console.log(
    `    ${prefix}${parts.join(c.dim(" · "))} ${c.dim(sym.arrow)} ${c.dim(result.settingsPath)}`,
  );
  if (!result.dryRun && result.installed.length > 0) {
    console.log(
      `    ${c.dim("registrados no settings.json — reinicie o Claude Code pra ativar.")}`,
    );
  }
}

export function depBadge(dep: ResolvedDependency): string {
  if (dep.plan) return c.gray(`· auto · ${dep.plan.kind}`);
  if (dep.manual) return c.gray("· manual · plugin");
  return c.gray("· manual");
}

export function printDepHeader(
  dep: ResolvedDependency,
  status?: "installed" | "available" | null,
): void {
  console.log("");
  const state =
    status === "installed"
      ? ` ${badge(`${sym.ok} instalada`, "green")}`
      : status === "available"
        ? ` ${badge("a instalar", "yellow")}`
        : "";
  console.log(
    `  ${c.magenta(sym.dot)} ${c.bold(dep.title)}${state} ${depBadge(dep)}`,
  );
  // Instalada → o header já basta; repo/descrição só poluem.
  if (status === "installed") return;
  if (dep.repo)
    console.log(`    ${link(dep.repo, dep.repo.replace(/^https?:\/\//, ""))}`);
  if (dep.description) console.log(`    ${c.dim(dep.description)}`);
}

export function printManualSteps(manual: string): void {
  const bar = c.yellow("│");
  console.log(
    `    ${bar} ${c.yellow.bold("manual")}${c.dim(" — a CLI não automatiza; faça no cliente:")}`,
  );
  for (const raw of manual.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^([^:`]{1,24}):\s*(.*)$/.exec(line);
    if (m)
      console.log(`    ${bar}   ${c.bold(m[1])}  ${highlightInlineCode(m[2])}`);
    else console.log(`    ${bar}   ${highlightInlineCode(line)}`);
  }
}
