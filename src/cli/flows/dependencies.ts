import { confirm } from "../../lib/prompts.js";
import {
  resolveDependency,
  isDependencyInstalled,
  runDependencyInstall,
  recordDependencyInstalled,
  skillsInstallPlan,
  type ResolvedDependency,
} from "../../lib/dependencies.js";
import { type SkillDoc } from "../../lib/skills.js";
import { c, sym, cmd, rule, sectionTitle } from "../../lib/colors.js";
import { printDepHeader, printManualSteps } from "../ui/render.js";
import { flowsCopy, fmt } from "../copy.js";

/**
 * Seção de dependências externas (docs `dependency` do pacote de skills).
 *
 * O comando é montado por `resolveDependency` a partir de campos estruturados e
 * rodado sem shell — a string `install:` nunca é executada.
 */
export async function offerDependencyInstall(
  deps: SkillDoc[],
  opts: { interactive: boolean; assumeYes?: boolean; enabled?: boolean },
): Promise<void> {
  if (deps.length === 0) return;

  console.log("");
  console.log(
    sectionTitle("Dependências externas", "libs que seus commands/skills usam"),
  );
  console.log(rule());

  const enabled = opts.enabled !== false;

  for (const node of deps) {
    const dep: ResolvedDependency = resolveDependency(node);
    // `detect:` deixa checar até `manual:` (plugins). Sem detecção nem plano → desconhecido.
    const installed = isDependencyInstalled(dep);
    const status = installed ? "installed" : dep.plan ? "available" : null;
    printDepHeader(dep, status);

    // Já instalada → o badge verde no header já diz tudo; nada de descrição/passos.
    if (installed) continue;

    // Sem instalador automatizável → passos manuais (plugin/marketplace/UI).
    if (!dep.plan) {
      if (dep.manual) printManualSteps(dep.manual);
      else {
        const hint = dep.displayInstall ? ` ${cmd(dep.displayInstall)}` : "";
        console.log(`    ${c.dim(dep.reason ?? "instale manualmente")}${hint}`);
      }
      continue;
    }

    await offerPlanInstall(dep, dep.plan, {
      enabled,
      interactive: opts.interactive,
      assumeYes: opts.assumeYes,
    });

    // Plugin de marketplace: o Claude Code é automatizado acima, mas Codex/Desktop
    // não — então ainda mostramos os passos manuais deles, se houver.
    if (dep.plan.kind === "claude-plugin" && dep.manual) {
      console.log(`    ${c.dim("outros clientes (Codex/Desktop) — manual:")}`);
      printManualSteps(dep.manual);
    }
  }
  console.log("");
}

/**
 * Oferece instalar as **skills recomendadas** (skills.sh) das stacks selecionadas —
 * cada uma `npx skills add <slug>` com `[y/N]`. Reforçam os padrões das rules; máx. 2
 * por stack pra não inflar o contexto do validador.
 */
export async function offerRuleSkills(
  slugs: string[],
  opts: { interactive: boolean; assumeYes?: boolean; enabled?: boolean },
): Promise<void> {
  if (slugs.length === 0) return;

  console.log("");
  console.log(sectionTitle("Skills recomendadas", "reforçam os padrões da stack (skills.sh)"));
  console.log(rule());

  const enabled = opts.enabled !== false;
  for (const slug of slugs) {
    const plan = skillsInstallPlan(slug);
    if (!plan) {
      console.log(`  ${c.magenta(sym.dot)} ${c.bold(slug)} ${c.yellow("· slug inválido")}`);
      continue;
    }
    const dep: ResolvedDependency = { id: slug, title: slug, plan };
    const installed = isDependencyInstalled(dep);
    printDepHeader(dep, installed ? "installed" : "available");
    if (installed) continue;
    await offerPlanInstall(dep, plan, {
      enabled,
      interactive: opts.interactive,
      assumeYes: opts.assumeYes,
    });
  }
  console.log("");
}

/** Oferece rodar um plano automatizável ([y/N] / `--yes`), respeitando o modo. */
async function offerPlanInstall(
  dep: ResolvedDependency,
  plan: NonNullable<ResolvedDependency["plan"]>,
  opts: { enabled: boolean; interactive: boolean; assumeYes?: boolean },
): Promise<void> {
  const runCmd = cmd(plan.command);

  if (!opts.enabled) {
    console.log(`    ${c.dim(`${sym.arrow} instalar`)}  ${runCmd}`);
    return;
  }

  let approved = opts.assumeYes === true;
  if (!approved) {
    if (!opts.interactive) {
      console.log(
        `    ${c.dim(`${sym.arrow} rode com`)} ${cmd("--yes")} ${c.dim("ou:")} ${runCmd}`,
      );
      return;
    }
    console.log(`    ${c.dim(`${sym.arrow} vai rodar`)}  ${runCmd}`);
    approved = await confirm({
      message: fmt(flowsCopy.installDep, { title: dep.title }),
      default: false,
    });
  }

  if (!approved) {
    console.log(`    ${c.dim("pulado — depois:")} ${runCmd}`);
    return;
  }

  console.log(`    ${c.dim(`${sym.gear} rodando…`)}`);
  const outcome = runDependencyInstall(plan);
  if (outcome.ok) recordDependencyInstalled(dep);
  console.log(
    outcome.ok
      ? `    ${c.green(`${sym.ok} instalado`)}`
      : `    ${c.red(`${sym.err} falhou (${outcome.error ?? `exit ${outcome.code}`})`)}`,
  );
}
