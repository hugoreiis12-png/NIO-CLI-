import {
  existsSync,
  readFileSync,
  readdirSync,
  copyFileSync,
  rmSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readJson, writeJson } from '../file-merge.js';
import { skillsDir } from '../skills/skills.js';
import { ensureDir } from '../provision/provision.js';
import { DEV_ROLE, type Selection } from '../skills/sections.js';
import { brand } from '../../brand.js';

/**
 * Provisionamento de hooks (só Claude Code). Um hook é um script + um gatilho que
 * precisa estar registrado no `settings.json` — então, além de copiar o script pro
 * namespace `hooks/nio/`, o CLI faz merge não-destrutivo do binding. Fonte:
 * `@nio-cli/skills/hooks/hooks.json` (flat — hooks são sempre de dev).
 */

/** Namespace sob o targetDir onde os scripts do nio vivem. Marca "nossa" entrada. */
const HOOKS_NS = `hooks/${brand.name}`;

/** Uma entrada declarada num `hooks/<role>/hooks.json`. */
interface HookManifestEntry {
  id?: number;
  event: string;
  matcher?: string;
  description?: string;
  script: string;
  clients?: string[];
}

/** Entrada já resolvida (com caminho absoluto do script de origem). */
interface ResolvedHook {
  id: number | null;
  event: string;
  matcher?: string;
  description?: string;
  script: string;
  /** Path absoluto do script no pacote de skills. */
  srcAbs: string;
}

export interface HookProvisionResult {
  settingsPath: string;
  scriptsDir: string;
  dryRun: boolean;
  installed: {
    event: string;
    matcher?: string;
    script: string;
    description?: string;
  }[];
  /** Scripts que estavam sob o namespace e foram removidos (saíram do manifesto). */
  prunedScripts: string[];
}

export interface HookProvisionOptions {
  skillsDir?: string;
  targetDir?: string;
  /** Surface do cliente (só `claude-code` é suportado hoje). */
  surface?: string;
  selection?: Selection;
  dryRun?: boolean;
}

function defaultTargetDir(): string {
  return join(homedir(), '.claude');
}

/** Lê e valida um `hooks.json`, devolvendo as entradas bem-formadas. */
function readManifest(path: string): HookManifestEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return [];
  }
  const list = (parsed as { hooks?: unknown })?.hooks;
  if (!Array.isArray(list)) return [];
  const out: HookManifestEntry[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const e = raw as Record<string, unknown>;
    if (typeof e.event !== 'string' || typeof e.script !== 'string') continue;
    out.push({
      id: typeof e.id === 'number' ? e.id : undefined,
      event: e.event,
      matcher: typeof e.matcher === 'string' ? e.matcher : undefined,
      description: typeof e.description === 'string' ? e.description : undefined,
      script: e.script,
      clients: Array.isArray(e.clients)
        ? e.clients.filter((c): c is string => typeof c === 'string')
        : undefined,
    });
  }
  return out;
}

/**
 * Descobre e resolve os hooks aplicáveis: lê `hooks/hooks.json` (flat), filtra por
 * cliente (`clients`), e devolve as entradas com o script de origem. Hooks são de
 * código → só entram se a seleção incluir o role `dev` (ou sem seleção).
 */
function collectHooks(
  dir: string,
  surface: string,
  selection: Selection | undefined,
): ResolvedHook[] {
  if (selection && !selection.roles.includes(DEV_ROLE)) return [];
  const hooksRoot = join(dir, 'hooks');
  const manifestPath = join(hooksRoot, 'hooks.json');
  if (!existsSync(manifestPath)) return [];

  const out: ResolvedHook[] = [];
  for (const entry of readManifest(manifestPath)) {
    if (entry.clients && !entry.clients.includes(surface)) continue;
    const srcAbs = join(hooksRoot, entry.script);
    if (!existsSync(srcAbs)) continue;
    out.push({
      id: entry.id ?? null,
      event: entry.event,
      matcher: entry.matcher,
      description: entry.description,
      script: entry.script,
      srcAbs,
    });
  }
  return out;
}

/** Uma entrada de comando é "nossa" se aponta pro namespace `hooks/nio/`. */
function isOurs(hook: unknown): boolean {
  const cmd = (hook as { command?: unknown })?.command;
  return typeof cmd === 'string' && cmd.includes(`${HOOKS_NS}/`);
}

interface SettingsHookGroup {
  matcher?: string;
  hooks: unknown[];
}

/**
 * Remove todas as entradas do nio de um bloco de `hooks` do settings, deixando
 * intactas as do usuário. Devolve o bloco limpo (eventos/grupos vazios removidos).
 */
function stripOurs(
  hooksCfg: Record<string, SettingsHookGroup[]>,
): Record<string, SettingsHookGroup[]> {
  const clean: Record<string, SettingsHookGroup[]> = {};
  for (const [event, groups] of Object.entries(hooksCfg)) {
    if (!Array.isArray(groups)) continue;
    const keptGroups: SettingsHookGroup[] = [];
    for (const group of groups) {
      const list = Array.isArray(group?.hooks) ? group.hooks : [];
      const kept = list.filter((h) => !isOurs(h));
      if (kept.length > 0) keptGroups.push({ ...group, hooks: kept });
    }
    if (keptGroups.length > 0) clean[event] = keptGroups;
  }
  return clean;
}

/** Remove recursivamente arquivos órfãos sob o namespace, exceto os recém-escritos. */
function pruneScripts(
  scriptsDir: string,
  keep: Set<string>,
  dryRun: boolean,
  pruned: string[],
): void {
  if (!existsSync(scriptsDir)) return;
  const walk = (abs: string): void => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const childAbs = join(abs, entry.name);
      if (entry.isDirectory()) {
        walk(childAbs);
        try {
          if (readdirSync(childAbs).length === 0 && !dryRun) rmSync(childAbs, { recursive: true });
        } catch {
          /* ignore */
        }
      } else if (entry.isFile()) {
        if (!keep.has(childAbs)) {
          if (!dryRun) rmSync(childAbs);
          pruned.push(childAbs);
        }
      }
    }
  };
  walk(scriptsDir);
}

/**
 * Provisiona os hooks do nio no Claude Code. Idempotente e não-destrutivo.
 * No-op (installed vazio) se o pacote não tem `hooks/` ou nada casa a seleção.
 */
export function provisionHooks(options: HookProvisionOptions = {}): HookProvisionResult {
  const dryRun = options.dryRun ?? false;
  const dir = options.skillsDir ?? skillsDir();
  const targetDir = options.targetDir ?? defaultTargetDir();
  const surface = options.surface ?? 'claude-code';
  const settingsPath = join(targetDir, 'settings.json');
  const scriptsDir = join(targetDir, HOOKS_NS);

  const resolved = collectHooks(dir, surface, options.selection);

  const writtenScripts = new Set<string>();
  const installed: HookProvisionResult['installed'] = [];
  for (const h of resolved) {
    const destAbs = join(scriptsDir, h.script);
    if (!dryRun) {
      ensureDir(scriptsDir);
      copyFileSync(h.srcAbs, destAbs);
    }
    writtenScripts.add(destAbs);
    installed.push({
      event: h.event,
      matcher: h.matcher,
      script: h.script,
      description: h.description,
    });
  }

  const prunedScripts: string[] = [];
  pruneScripts(scriptsDir, writtenScripts, dryRun, prunedScripts);

  // Merge no settings.json: tira as nossas entradas antigas, re-adiciona as atuais.
  const settings = (readJson(settingsPath) as Record<string, unknown> | null) ?? {};
  const currentHooks =
    (settings.hooks as Record<string, SettingsHookGroup[]> | undefined) ?? {};
  const merged = stripOurs(currentHooks);

  for (const h of resolved) {
    const commandPath = join(scriptsDir, h.script).split('\\').join('/');
    const ourHook = { type: 'command', command: `python3 "${commandPath}"` };
    const groups = merged[h.event] ?? (merged[h.event] = []);
    let group = groups.find((g) => g.matcher === h.matcher);
    if (!group) {
      group = h.matcher !== undefined ? { matcher: h.matcher, hooks: [] } : { hooks: [] };
      groups.push(group);
    }
    group.hooks.push(ourHook);
  }

  if (!dryRun) {
    if (Object.keys(merged).length > 0) {
      settings.hooks = merged;
    } else {
      delete settings.hooks;
    }
    writeJson(settingsPath, settings);
  }

  return { settingsPath, scriptsDir, dryRun, installed, prunedScripts };
}

/** Remove tudo que o nio instalou de hooks (scripts + entradas do settings). */
export function uninstallHooks(
  options: { targetDir?: string; dryRun?: boolean } = {},
): { settingsPath: string; removedScripts: string[]; dryRun: boolean } {
  const dryRun = options.dryRun ?? false;
  const targetDir = options.targetDir ?? defaultTargetDir();
  const settingsPath = join(targetDir, 'settings.json');
  const scriptsDir = join(targetDir, HOOKS_NS);

  const removedScripts: string[] = [];
  if (existsSync(scriptsDir)) {
    if (!dryRun) rmSync(scriptsDir, { recursive: true, force: true });
    removedScripts.push(scriptsDir);
  }

  const settings = readJson(settingsPath) as Record<string, unknown> | null;
  if (settings && settings.hooks) {
    const merged = stripOurs(settings.hooks as Record<string, SettingsHookGroup[]>);
    if (!dryRun) {
      if (Object.keys(merged).length > 0) settings.hooks = merged;
      else delete settings.hooks;
      writeJson(settingsPath, settings);
    }
  }

  return { settingsPath, removedScripts, dryRun };
}
