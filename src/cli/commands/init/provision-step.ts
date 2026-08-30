import { claudeTarget, opencodeTarget, type ProvisionTarget } from "../../../lib/clients/targets.js";
import { provision } from "../../../lib/provision/provision.js";
import { provisionHooks } from "../../../lib/clients/hooks.js";
import { fetchSkills } from "../../../lib/skills/skills-cache.js";
import { c } from "../../../lib/colors.js";
import { startSpinner } from "../../../lib/spinner.js";
import { printProvisionResult, printHookResult } from "../../ui/render.js";
import { SyncReport, summarizeProvision } from "../../ui/report.js";
import { track, provisionedItems } from "../../../lib/telemetry.js";
import { VERSION } from "../../../version.js";
import type { ProjectConfig } from "../../../config.js";
import type { ClientChoice } from "./clients-step.js";

/** Só OpenCode por enquanto (decisão de 2026-07-27) — qualquer escolha (ou
 * nenhuma) cai no opencodeTarget. */
export function resolveProvisionTargets(clientConfigs: ClientChoice[]): Set<ProvisionTarget> {
  return new Set([opencodeTarget]);
}

/** Baixa o repo aberto de skills pro cache e registra a seção no report. */
export async function fetchSkillsStep(report: SyncReport): Promise<void> {
  const fetchSpinner = startSpinner("Baixando skills do repo…");
  const fetched = await fetchSkills({ force: true });
  fetchSpinner.stop();
  if (fetched.status === "failed") {
    report.add({
      id: "fetch",
      title: "Skills",
      status: "error",
      summary: "falha ao baixar",
      lines: [`    ${c.dim(fetched.error ?? "")}`],
    });
  } else if (fetched.status === "fetched") {
    report.add({
      id: "fetch",
      title: "Skills",
      status: "ok",
      summary: `baixadas (${fetched.repo}@${fetched.ref})`,
      lines: [],
    });
  } else {
    report.add({
      id: "fetch",
      title: "Skills",
      status: "warn",
      summary: "usando cache local",
      lines: fetched.error ? [`    ${c.dim(fetched.error)}`] : [],
    });
  }
}

export function provisionTargetsStep(
  targets: Set<ProvisionTarget>,
  config: ProjectConfig,
  uidByName: Map<string, string | null>,
  report: SyncReport,
): void {
  for (const target of targets) {
    try {
      const result = provision({ target, selection: config.selection });
      const { status, summary } = summarizeProvision(result.files);
      report.addCaptured(
        { id: `prov-${target.id}`, title: target.label, status, summary },
        () => printProvisionResult(result),
      );
      track({
        type: "provision",
        client: target.id,
        sections: config.selection,
        items: provisionedItems(result.files, uidByName),
        version: VERSION,
      });
    } catch (err) {
      report.add({
        id: `prov-${target.id}`,
        title: target.label,
        status: "error",
        summary: "falhou",
        lines: [`    ${c.dim((err as Error).message)}`],
      });
    }
  }
}

/** Hooks (só Claude Code): registra os gatilhos no ~/.claude/settings.json. */
export function provisionHooksStep(
  targets: Set<ProvisionTarget>,
  config: ProjectConfig,
  report: SyncReport,
): void {
  if (!targets.has(claudeTarget)) return;
  try {
    const h = provisionHooks({ surface: claudeTarget.surface, selection: config.selection });
    report.addCaptured(
      { id: "hooks", title: "Hooks", status: "ok", summary: `${h.installed.length} hooks` },
      () => printHookResult(h),
    );
  } catch (err) {
    report.add({
      id: "hooks",
      title: "Hooks",
      status: "warn",
      summary: "pulado",
      lines: [`    ${c.dim((err as Error).message)}`],
    });
  }
}
