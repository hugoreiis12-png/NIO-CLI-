/**
 * `ScaffoldGateway` (`core/lang.ts`) — materializa uma recipe no projeto, **ciente
 * de contexto** (regra do dono do projeto: instalar só "de acordo com o projeto",
 * nunca cego/destrutivo).
 *
 * ISOLAMENTO POR CONSTRUÇÃO:
 *  - `plan()` só monta a lista de passos (zero IO de escrita/execução; só o
 *    detector lê o dir).
 *  - `apply(plan, { dryRun: true })` devolve tudo `planned` sem tocar em nada.
 *  - execução real usa `spawnSync` SEM shell, sempre dentro de `targetDir`.
 *  - **Nunca lança**: falha vira `status: 'failed'`.
 *
 * Contexto:
 *  - **greenfield** (dir vazio): init do package manager + tipagens + instala os
 *    pacotes do framework/ORM escolhidos (se mapeados) + marker.
 *  - **brownfield compatível** (projeto existente do mesmo ecossistema): NÃO
 *    re-inicializa; só **adiciona** os pacotes escolhidos + marker.
 *  - **incompatível** (ex.: framework Python num projeto Node): não instala nada
 *    — registra no marker + o preview mostra que nada roda.
 *  Framework/ORM sem mapeamento (`PackageMap`) também caem no marker (não instala).
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  LanguageRecipe,
  PackageMap,
  ProjectContext,
  ProjectDetector,
  ScaffoldChoices,
  ScaffoldGateway,
  ScaffoldPlan,
  ScaffoldStep,
  ScaffoldStepResult,
} from '../../core/lang.js';
import { createProjectDetector } from './project-detector.js';
import { createPackageMap } from './package-map.js';

/** Comando de init por package manager/runtime (só em greenfield). */
const INIT: Record<string, { program: string; args: string[] }> = {
  npm: { program: 'npm', args: ['init', '-y'] },
  pnpm: { program: 'pnpm', args: ['init'] },
  yarn: { program: 'yarn', args: ['init', '-y'] },
  uv: { program: 'uv', args: ['init'] },
  pip: { program: 'python', args: ['-m', 'venv', '.venv'] },
  nuget: { program: 'dotnet', args: ['new', 'console'] },
};

/** Verbo de "adicionar dev-dependency" no ecossistema node (pra tipagens). */
const NODE_ADD: Record<string, string> = { npm: 'install', pnpm: 'add', yarn: 'add' };

/** Comando de "adicionar dependência" (1 pacote por chamada) por package manager. */
function addCommand(pm: string, pkg: string): { program: string; args: string[] } | null {
  switch (pm) {
    case 'npm':
      return { program: 'npm', args: ['install', pkg] };
    case 'pnpm':
      return { program: 'pnpm', args: ['add', pkg] };
    case 'yarn':
      return { program: 'yarn', args: ['add', pkg] };
    case 'pip':
      return { program: 'pip', args: ['install', pkg] };
    case 'uv':
      return { program: 'uv', args: ['add', pkg] };
    case 'pipenv':
      return { program: 'pipenv', args: ['install', pkg] };
    case 'poetry':
      return { program: 'poetry', args: ['add', pkg] };
    case 'conda':
      return { program: 'conda', args: ['install', '-y', pkg] };
    case 'nuget':
      return { program: 'dotnet', args: ['add', 'package', pkg] };
    default:
      return null;
  }
}

/** O ecossistema da recipe bate com o projeto? Greenfield sempre bate (vamos iniciar). */
function fitsEcosystem(recipe: LanguageRecipe, ctx: ProjectContext): boolean {
  if (ctx.empty) return true;
  switch (recipe.runtime) {
    case 'node':
      return ctx.hasPackageJson;
    case 'python':
      return ctx.hasPyproject || ctx.hasRequirements;
    case 'dotnet':
      return ctx.hasCsproj;
    default:
      return false;
  }
}

function buildPlanWith(
  detector: ProjectDetector,
  packageMap: PackageMap,
  recipe: LanguageRecipe,
  choices: ScaffoldChoices,
  targetDir: string,
): ScaffoldPlan {
  const ctx = detector.detect(targetDir);
  const pm = choices.packageManager ?? ctx.nodePackageManager ?? recipe.packageManagers[0];
  const fits = fitsEcosystem(recipe, ctx);
  const steps: ScaffoldStep[] = [];

  // Greenfield: inicializa + tipagens (node-family). Brownfield: não re-inicializa.
  if (ctx.empty) {
    const init = INIT[pm];
    if (init) {
      steps.push({ kind: 'run', program: init.program, args: init.args, cwd: targetDir, label: `inicializa (${pm})` });
    }
    const nodeAdd = NODE_ADD[pm];
    if (nodeAdd && recipe.typings.length > 0) {
      steps.push({ kind: 'run', program: pm, args: [nodeAdd, '-D', ...recipe.typings], cwd: targetDir, label: 'instala tipagens' });
    }
  }

  // Framework/ORM escolhidos → instala como pacote SE mapeado E o ecossistema bate.
  const installed: string[] = [];
  const skipped: string[] = [];
  for (const displayName of [choices.framework, choices.orm]) {
    if (!displayName) continue;
    const pkg = packageMap.resolve(recipe.language, displayName);
    const cmd = pkg && fits ? addCommand(pm, pkg) : null;
    if (pkg && fits && cmd) {
      installed.push(pkg);
      steps.push({ kind: 'run', program: cmd.program, args: cmd.args, cwd: targetDir, label: `instala ${displayName} (${pkg})` });
    } else {
      skipped.push(displayName); // sem mapa OU ecossistema incompatível → só marker
    }
  }

  const marker = {
    language: recipe.language,
    packageManager: pm,
    framework: choices.framework ?? null,
    orm: choices.orm ?? null,
    greenfield: ctx.empty,
    ecosystemFits: fits,
    installed,
    skipped,
  };
  steps.push({
    kind: 'write',
    path: join(targetDir, '.nio-lang.json'),
    content: JSON.stringify(marker, null, 2) + '\n',
    label: 'registra escolhas/contexto (.nio-lang.json)',
  });

  return { language: recipe.language, targetDir, steps };
}

function runStep(step: ScaffoldStep): ScaffoldStepResult {
  try {
    if (step.kind === 'run') {
      const res = spawnSync(step.program, step.args, { cwd: step.cwd, stdio: 'inherit' });
      if (res.error) return { step, status: 'failed', error: res.error.message };
      if (res.status !== 0) return { step, status: 'failed', error: `código ${res.status}` };
    } else {
      mkdirSync(dirname(step.path), { recursive: true });
      writeFileSync(step.path, step.content);
    }
    return { step, status: 'done' };
  } catch (err) {
    return { step, status: 'failed', error: (err as Error).message };
  }
}

export function createScaffoldGateway(
  deps: { detector?: ProjectDetector; packageMap?: PackageMap } = {},
): ScaffoldGateway {
  const detector = deps.detector ?? createProjectDetector();
  const packageMap = deps.packageMap ?? createPackageMap();
  return {
    plan(recipe, choices, targetDir) {
      return buildPlanWith(detector, packageMap, recipe, choices, targetDir);
    },
    apply(plan, opts) {
      const dryRun = opts?.dryRun ?? false;
      if (dryRun) return plan.steps.map((step) => ({ step, status: 'planned' as const }));
      return plan.steps.map(runStep);
    },
  };
}
