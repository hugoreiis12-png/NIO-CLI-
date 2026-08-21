import { join } from 'node:path';
import type { SkillDoc } from './skills.js';
import { homePath } from '../brand.js';

/**
 * Resolve dependências (docs `dependency`) num plano; o IO vive em `dependency-install.ts`
 * (reexportado abaixo). SEGURANÇA: nunca executamos `install:` (só exibição) — lemos campos
 * allowlisted (`npm:`/`skills:`/`git:`), validados por regex, e rodamos via `spawnSync` sem shell.
 */

/** Nome de pacote npm (com escopo opcional). Sem espaços/metacaracteres de shell. */
const NPM_NAME_RE = /^(?:@[a-z0-9-][a-z0-9-._]*\/)?[a-z0-9-][a-z0-9-._]*$/i;

/** Só clones https do GitHub. */
const GIT_URL_RE = /^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+(?:\.git)?$/;

/** Slug pro `npx skills add`: `owner/repo` ou `owner/repo/skill` (skill específica). */
const SKILLS_REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)?$/;

/** Id de plugin do Claude Code: `plugin@marketplace`. */
const PLUGIN_ID_RE = /^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+$/;

export type DependencyPlan =
  | { kind: 'npm'; pkg: string; program: string; args: string[]; command: string }
  | { kind: 'skills'; repo: string; program: string; args: string[]; command: string }
  | { kind: 'git'; url: string; dest: string; program: string; args: string[]; command: string }
  // Plugin de marketplace do Claude Code — instalável de forma NÃO-interativa via o
  // CLI `claude plugin` (marketplace add + install). Vários passos sequenciais.
  | {
      kind: 'claude-plugin';
      marketplace: string;
      plugin: string;
      steps: { program: string; args: string[] }[];
      command: string;
    };

export interface ResolvedDependency {
  id: string;
  title: string;
  description?: string;
  repo?: string;
  /** `install:` cru — SÓ pra exibição, nunca executado. */
  displayInstall?: string;
  /** Plano executável (validado) ou `null` se não houver instalador estruturado válido. */
  plan: DependencyPlan | null;
  /**
   * Instrução de instalação **manual** (`manual:` do frontmatter) — pra deps que a
   * CLI não consegue automatizar (ex.: plugins de marketplace do Claude/Codex,
   * passos de `/hooks`, instalação por UI). Impressa, nunca executada.
   */
  manual?: string;
  /** Motivo quando `plan` é null — mostrado como instrução. */
  reason?: string;
  /**
   * Globs de detecção (`detect:` do frontmatter) — se qualquer um existir, a dep é
   * considerada instalada. Serve pra `manual:` (plugins) que não têm checagem por
   * plano. Suporta `~`, `*` (um nível) e `**` (qualquer profundidade); segue
   * symlinks, então funciona com dotfiles.
   */
  detect?: string[];
}

/** Onde clonamos deps do tipo `git` (`~/.nio/deps/<id>`). */
function depsDir(): string {
  return homePath('deps');
}

/** Plano `skills` (skills.sh) a partir de um slug validado, ou `null` se inválido. */
export function skillsInstallPlan(slug: string): DependencyPlan | null {
  const s = slug.trim();
  if (!SKILLS_REPO_RE.test(s)) return null;
  return {
    kind: 'skills',
    repo: s,
    program: 'npx',
    args: ['--yes', 'skills', 'add', s],
    command: `npx --yes skills add ${s}`,
  };
}

/** Plano resolvido pra um campo válido, ou o motivo de rejeição (regex não bateu). */
type PlanOrReason = { plan: DependencyPlan; reason?: undefined } | { plan: null; reason: string };

function resolveNpmPlan(npm: string): PlanOrReason {
  if (!NPM_NAME_RE.test(npm)) return { plan: null, reason: `nome de pacote npm inválido: "${npm}"` };
  return {
    plan: { kind: 'npm', pkg: npm, program: 'npm', args: ['install', '-g', npm], command: `npm install -g ${npm}` },
  };
}

// `owner/repo/skill` → instala o skill específico com `--skill` (senão o
// `skills add` clona o monorepo inteiro e não acha o SKILL.md).
function resolveSkillsPlan(skills: string): PlanOrReason {
  if (!SKILLS_REPO_RE.test(skills)) {
    return { plan: null, reason: `repo de skills inválido (owner/repo[/skill]): "${skills}"` };
  }
  const segs = skills.split('/');
  const repoSlug = segs.slice(0, 2).join('/');
  const skillName = segs.length >= 3 ? segs.slice(2).join('/') : null;
  const args = skillName
    ? ['--yes', 'skills', 'add', repoSlug, '--skill', skillName]
    : ['--yes', 'skills', 'add', repoSlug];
  return { plan: { kind: 'skills', repo: skills, program: 'npx', args, command: `npx ${args.join(' ')}` } };
}

function resolveGitPlan(git: string, id: string): PlanOrReason {
  if (!GIT_URL_RE.test(git)) {
    return { plan: null, reason: `URL git não permitida (só https://github.com/…): "${git}"` };
  }
  const dest = join(depsDir(), id);
  return {
    plan: {
      kind: 'git',
      url: git,
      dest,
      program: 'git',
      args: ['clone', '--depth', '1', git, dest],
      command: `git clone --depth 1 ${git} ${dest}`,
    },
  };
}

// Plugin do Claude Code: `claude-plugin: <owner/repo> <plugin@marketplace>`.
function resolveClaudePluginPlan(claudePlugin: string): PlanOrReason {
  const [marketplace, plugin] = claudePlugin.split(/\s+/);
  if (marketplace && plugin && SKILLS_REPO_RE.test(marketplace) && PLUGIN_ID_RE.test(plugin)) {
    return {
      plan: {
        kind: 'claude-plugin',
        marketplace,
        plugin,
        steps: [
          { program: 'claude', args: ['plugin', 'marketplace', 'add', marketplace] },
          { program: 'claude', args: ['plugin', 'install', plugin] },
        ],
        command: `claude plugin marketplace add ${marketplace} && claude plugin install ${plugin}`,
      },
    };
  }
  return {
    plan: null,
    reason: `claude-plugin inválido (esperado "<owner/repo> <plugin@marketplace>"): "${claudePlugin}"`,
  };
}

function applyPlanResult(base: ResolvedDependency, r: PlanOrReason): ResolvedDependency {
  return r.plan ? { ...base, plan: r.plan } : { ...base, reason: r.reason };
}

/**
 * Resolve um doc `dependency` num plano de instalação a partir de campos
 * estruturados. Precedência: `npm:` > `skills:` > `git:`. Sem campo válido → `plan: null`.
 * Passos manuais ficam disponíveis mesmo com plano automatizável (ex.: um plugin
 * `claude-plugin` que o Claude Code instala sozinho mas o Codex/Desktop não); sem
 * nenhum instalador automatizável, cai pra instrução manual (plugin/marketplace/UI).
 */
export function resolveDependency(node: SkillDoc): ResolvedDependency {
  const fm = node.frontmatter;
  const base: ResolvedDependency = {
    id: node.id,
    title: node.title,
    description: node.description || fm.description || undefined,
    repo: fm.repo || fm.homepage || undefined,
    displayInstall: fm.install || undefined,
    detect: parseDetect(fm.detect),
    manual: fm.manual?.trim() || undefined,
    plan: null,
  };

  const npm = fm.npm?.trim();
  if (npm) return applyPlanResult(base, resolveNpmPlan(npm));

  const skills = fm.skills?.trim();
  if (skills) return applyPlanResult(base, resolveSkillsPlan(skills));

  const git = fm.git?.trim();
  if (git) return applyPlanResult(base, resolveGitPlan(git, node.id));

  const claudePlugin = fm['claude-plugin']?.trim();
  if (claudePlugin) return applyPlanResult(base, resolveClaudePluginPlan(claudePlugin));

  const manual = fm.manual?.trim();
  if (manual) return { ...base, manual, reason: 'instalação manual' };

  return { ...base, reason: 'sem instalador estruturado (npm:/skills:/git:/manual:) — instale manualmente' };
}

/** `detect:` cru → lista de globs (separados por vírgula/quebra de linha). */
function parseDetect(value?: string): string[] | undefined {
  if (!value) return undefined;
  const list = value
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? list : undefined;
}

// Checagem de "já instalado", execução do plano e o marcador de instalações são
// IO puro — vivem em `dependency-install.ts`. Reexportado daqui pra manter o
// import único (`from '../lib/dependencies.js'`) pro resto da CLI.
export {
  recordDependencyInstalled,
  isDependencyInstalled,
  runDependencyInstall,
  type InstallOutcome,
} from './dependency-install.js';
