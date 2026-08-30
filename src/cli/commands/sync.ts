import type { Command } from "commander";
import { brand } from "../../brand.js";
import { spawnSync } from "node:child_process";
import { confirm } from "../../lib/prompts.js";
import { loadSession } from "../../lib/auth/session-store.js";
import { SessionManager } from "../../app/session-manager.js";
import { loadProjectConfig } from "../../config.js";
import { checkForUpdate } from "../../lib/version-check.js";
import { uninstallProvision, provision } from "../../lib/provision/provision.js";
import { provisionHooks, uninstallHooks } from "../../lib/clients/hooks.js";
import { readDependencies, skillIdMap } from "../../lib/skills/skills.js";
import { fetchSkills } from "../../lib/skills/skills-cache.js";
import { concatenateRules, collectRuleSkills } from "../../lib/skills/rules.js";
import { writeRepoHarness } from "../../lib/clients/harness.js";
import { patternsExist, runPatternsAnalysis } from "../../lib/skills/patterns.js";
import { offerShellCompletion } from "../flows/completion.js";
import { ensureUserConfig } from "../flows/user-config.js";
import { startSpinner } from "../../lib/spinner.js";
import { track, provisionedItems, flushTelemetry } from "../../lib/telemetry.js";
import { VERSION } from "../../version.js";
import { claudeTarget, opencodeTarget, detectConfiguredTargets } from "../../lib/clients/targets.js";
import { coworkConfigured, installCoworkGlobal } from "../../lib/clients/client-configs.js";
import { c, sym, cmd, box, sectionTitle, clearScreen } from "../../lib/colors.js";
import { printProvisionResult, printHookResult, printHarnessResult } from "../ui/render.js";
import {
  SyncReport,
  renderReport,
  browseReport,
  resolveReportMode,
  summarizeProvision,
} from "../ui/report.js";
import { offerDependencyInstall, offerRuleSkills } from "../flows/dependencies.js";
import { syncCopy } from "../copy.js";

/**
 * Se a sessão ativa foi criada com uma recipe (`config.extra.recipe`), o `sync`
 * acabou de baixar uma versão possivelmente nova dela — oferece re-materializar
 * (Sprint 5.4). Best-effort: sem login / banco fora / sem recipe → silencioso.
 */
async function offerRecipeRematerialize(opts: { interactive: boolean; assumeYes?: boolean }): Promise<void> {
  try {
    const stored = await loadSession();
    if (!stored) return;
    const manager = new SessionManager();
    const active = await manager.findActive(stored.userId);
    const slug = (active?.config.extra as { recipe?: string } | undefined)?.recipe;
    if (!active || !slug) return;

    console.log("");
    console.log(sectionTitle("Recipe da sessão ativa", `"${slug}" — pode ter mudado no repo`));
    const approved =
      opts.assumeYes === true ||
      (opts.interactive &&
        (await confirm({
          message: `Re-materializar a sessão "${active.name}" com a recipe atualizada?`,
          default: false,
        })));
    if (!approved) {
      console.log(`  ${c.dim("pulado — depois:")} ${cmd(`${brand.name} env materialize`)}`);
      return;
    }
    const built = await manager.materialize(stored.userId);
    console.log(`  ${c.green(sym.ok)} ${active.name} re-materializada (${built.config.mcps?.length ?? 0} MCPs).`);
    for (const w of built.recipeWarnings) console.log(`  ${c.yellow(sym.warn)} recipe: ${w} ignorado.`);
  } catch (err) {
    console.log(`  ${c.dim(`recipe da sessão ativa não checada: ${(err as Error).message}`)}`);
  }
}

export function registerSyncCommand(program: Command): void {
  program
    .command("sync")
    .description(
      "Instala/atualiza skills, commands e agents nos clientes configurados, a partir do bundle (idempotente); checa atualização do pacote",
    )
    .option("--dry-run", "mostra o que mudaria, sem escrever nada")
    .option("--force", "sobrescreve arquivos divergentes de mesmo nome")
    .option("--no-prune", "mantém arquivos que saíram do bundle")
    .option("--uninstall", "remove os arquivos que o nio instalou")
    .option(
      "--no-install-deps",
      "não oferece instalar as libs externas requeridas",
    )
    .option(
      "-y, --yes",
      "aprova automaticamente a instalação das libs (não-interativo)",
    )
    .option(
      "--reanalyze",
      "re-roda a análise de patterns (regera docs/_patterns.md) mesmo se já existir",
    )
    .option("--verbose", "expande todos os detalhes inline (sem resumo/menu)")
    .option("--quiet", "só o resumo de uma linha por seção")
    .action(
      async (opts: {
        dryRun?: boolean;
        force?: boolean;
        prune?: boolean;
        uninstall?: boolean;
        installDeps?: boolean;
        yes?: boolean;
        reanalyze?: boolean;
        verbose?: boolean;
        quiet?: boolean;
      }) => {
        try {
          const upd = await checkForUpdate();
          if (upd?.hasUpdate) {
            console.log("");
            console.log(
              box(
                `${c.yellow(sym.warn)} ${c.bold(`nova versão do ${brand.name}`)}  ` +
                  `${c.dim(upd.current)} ${c.dim(sym.arrow)} ${c.green(upd.latest)}\n` +
                  `${c.dim("atualizar:")} ${cmd(`npm install -g ${upd.name}@latest`)}`,
                { borderColor: "yellow", title: "atualização" },
              ),
            );
            const interactive = Boolean(process.stdout.isTTY);
            const doUpdate =
              !opts.dryRun &&
              (opts.yes === true ||
                (interactive &&
                  (await confirm({
                    message: syncCopy.update.confirm,
                    default: true,
                  }))));
            if (doUpdate) {
              console.log(`  ${c.dim(`${sym.gear} rodando…`)}`);
              const res = spawnSync(
                "npm",
                ["install", "-g", `${upd.name}@latest`],
                { stdio: "inherit" },
              );
              if (res.status === 0) {
                console.log(
                  `  ${c.green(`${sym.ok} atualizado pra ${upd.latest}`)} ${c.dim(`— rode \`${brand.name} sync\` de novo.`)}`,
                );
                return;
              }
              console.log(
                `  ${c.red(`${sym.err} falha ao atualizar`)} ${c.dim("— seguindo com a versão atual.")}`,
              );
            }
          }

          const mode = resolveReportMode(opts);
          const report = new SyncReport();

          // Puxa a versão mais recente do repo aberto de skills pro cache local
          // (~/.nio/skills). É a fonte que `provision`/`readDependencies` leem.
          if (!opts.dryRun) {
            const sp = startSpinner("Atualizando skills do repo…");
            const fetched = await fetchSkills({ force: true });
            sp.stop();
            if (fetched.status === "fetched") {
              report.add({
                id: "fetch",
                title: "Skills",
                status: "ok",
                summary: `atualizadas (${fetched.repo}@${fetched.ref})`,
                lines: [],
              });
            } else if (fetched.status === "cached") {
              report.add({
                id: "fetch",
                title: "Skills",
                status: "warn",
                summary: "usando cache local" + (fetched.error ? " (fetch falhou)" : ""),
                lines: fetched.error ? [`    ${c.dim(fetched.error)}`] : [],
              });
            } else {
              console.error(
                `  ${c.red(sym.err)} não consegui obter as skills: ${fetched.error}`,
              );
              process.exit(1);
            }
          }

          const detected = detectConfiguredTargets();
          const targets = detected.length > 0 ? detected : [opencodeTarget];

          if (opts.uninstall) {
            for (const target of targets) {
              console.log("");
              console.log(`  ${c.magenta(sym.dot)} ${c.bold(target.label)}`);
              const result = uninstallProvision({
                targetDir: target.targetDir(),
                dryRun: opts.dryRun,
              });
              for (const rel of result.removed) console.log(`  [-] ${rel}`);
              for (const rel of result.kept)
                console.log(`  [!] ${rel} (modificado localmente — mantido)`);
              const prefix = result.dryRun ? "[dry-run] " : "";
              console.log(
                `${prefix}${result.removed.length} removidos · ${result.kept.length} preservados → ${result.targetDir}`,
              );
              if (target === claudeTarget) {
                const h = uninstallHooks({ dryRun: opts.dryRun });
                if (h.removedScripts.length > 0)
                  console.log(`  [-] hooks: ${h.removedScripts.join(", ")}`);
              }
            }
            return;
          }

          let config = null;
          try {
            config = loadProjectConfig();
          } catch {
            /* sem nio.json / inválido → provisiona tudo */
          }
          const selection = config?.selection;

          // Split de config: migra o formato antigo + garante o nio.user.json (prefs).
          if (!opts.dryRun) {
            await ensureUserConfig({
              interactive: Boolean(process.stdout.isTTY),
              hasRepoConfig: Boolean(config),
            });
          }

          // Telemetria v1 removida — `track` é no-op v2 (lib/telemetry.ts).
          const uidByName = skillIdMap();

          // ---- Fase informativa: coleta cada etapa como seção (não imprime na hora) ----

          for (const target of targets) {
            const result = provision({
              target,
              selection,
              dryRun: opts.dryRun,
              force: opts.force,
              prune: opts.prune,
            });
            const { status, summary } = summarizeProvision(result.files);
            report.addCaptured(
              { id: `prov-${target.id}`, title: target.label, status, summary },
              () => printProvisionResult(result),
            );
            track({
              type: "provision",
              client: target.id,
              sections: selection,
              items: provisionedItems(result.files, uidByName),
              version: VERSION,
            });

            // Hooks (só Claude Code): registra os gatilhos no settings.json.
            if (target === claudeTarget) {
              const h = provisionHooks({
                surface: claudeTarget.surface,
                selection,
                dryRun: opts.dryRun,
              });
              report.addCaptured(
                { id: "hooks", title: "Hooks", status: "ok", summary: `${h.installed.length} hooks` },
                () => printHookResult(h),
              );
            }
          }

          // Reafirma o config do Cowork (idempotente).
          if (!opts.dryRun && coworkConfigured()) {
            const result = installCoworkGlobal();
            if (result.status === "updated") {
              report.add({
                id: "cowork",
                title: "Claude Desktop (Cowork)",
                status: "ok",
                summary: "config atualizado — reinicie o app",
                lines: [`    ${c.dim(result.path)}`],
              });
            }
          }

          // Harness no repo (rules + AGENTS.md + CLAUDE.md). Idempotente.
          if (!opts.dryRun && config) {
            // Overview de projeto (v1) removido — sem fonte de contexto nesse
            // caminho hoje; harness segue só com as rules.
            try {
              const h = writeRepoHarness(process.cwd(), {
                rulesMarkdown: concatenateRules(config.selection ?? { roles: [], stacks: {} }),
                overview: "",
              });
              const changed = [h.rules, h.agents, h.claude].some(
                (a) => a !== "unchanged" && a !== "empty",
              );
              report.addCaptured(
                {
                  id: "harness",
                  title: "Harness (repo)",
                  status: "ok",
                  summary: changed ? `rules ${h.rules} · AGENTS ${h.agents}` : "sem mudanças",
                },
                () => printHarnessResult(h),
              );
            } catch (err) {
              report.add({
                id: "harness",
                title: "Harness (repo)",
                status: "warn",
                summary: "pulado",
                lines: [`    ${c.dim((err as Error).message)}`],
              });
            }
          }

          // ---- Render do resumo + menu navegável (só no modo interativo) ----
          // Limpa a tela (TTY) pra o resumo aparecer sem o "lixo" das etapas acima.
          clearScreen();
          renderReport(report, mode);
          if (mode === "summary") await browseReport(report);

          // ---- Fase de ações: ofertas [y/N] (patterns, deps, completion) ----
          console.log("");
          console.log(sectionTitle("Ações", "instalações e ajustes"));

          // Patterns (IA): auto no 1º sync (com [y/N]) ou via --reanalyze; skip-if-exists.
          if (!opts.dryRun && config) {
            const cwd = process.cwd();
            if (opts.reanalyze || !patternsExist(cwd)) {
              const interactive = Boolean(process.stdout.isTTY);
              let approved = opts.yes === true || opts.reanalyze === true;
              if (!approved && interactive) {
                approved = await confirm({
                  message:
                    "Analisar o repo agora e gerar docs/_patterns.md? (roda claude/codex headless)",
                  default: true,
                });
              }
              if (approved) {
                console.log(`  ${c.dim(`${sym.gear} analisando patterns…`)}`);
                const out = runPatternsAnalysis(cwd);
                if (!out.ran) {
                  console.log(`  ${c.yellow(sym.warn)} ${c.dim(out.reason ?? "análise não rodou")}`);
                } else {
                  console.log(
                    out.ok
                      ? `  ${c.green(sym.ok)} docs/_patterns.md ${c.dim(`(${out.agent})`)}`
                      : `  ${c.red(sym.err)} ${c.dim(`análise falhou (${out.agent})`)}`,
                  );
                }
              } else {
                console.log(
                  `  ${c.dim("patterns pulado — rode")} ${cmd(`${brand.name} sync --reanalyze`)} ${c.dim("depois.")}`,
                );
              }
            }
          }

          // Oferece instalar as libs externas do pacote. Em --dry-run só lista.
          await offerDependencyInstall(readDependencies(selection), {
            interactive: Boolean(process.stdout.isTTY),
            assumeYes: opts.yes,
            enabled: opts.installDeps !== false && !opts.dryRun,
          });

          // Skills recomendadas (skills.sh) das stacks do nio.json.
          await offerRuleSkills(
            collectRuleSkills(config?.selection ?? { roles: [], stacks: {} }),
            {
              interactive: Boolean(process.stdout.isTTY),
              assumeYes: opts.yes,
              enabled: opts.installDeps !== false && !opts.dryRun,
            },
          );

          // Recipe da sessão ativa pode ter mudado no repo → oferece re-materializar (5.4).
          if (!opts.dryRun) {
            await offerRecipeRematerialize({
              interactive: Boolean(process.stdout.isTTY),
              assumeYes: opts.yes,
            });
          }

          // Valida o autocomplete do shell; se faltar, prompta (só interativo).
          if (!opts.dryRun) {
            await offerShellCompletion({
              interactive: Boolean(process.stdout.isTTY),
              assumeYes: opts.yes,
            });
          }

          // Garante que os eventos de telemetria saiam antes do processo encerrar.
          await flushTelemetry();
        } catch (err) {
          console.error(`[erro] ${(err as Error).message}`);
          process.exit(1);
        }
      },
    );
}
