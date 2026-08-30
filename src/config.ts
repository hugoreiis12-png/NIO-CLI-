import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, isAbsolute, dirname } from 'node:path';
import { brand, env } from './brand.js';
import { DEV_ROLE, GENERAL, type Selection } from './lib/skills/sections.js';

/** Arquivo de binding do projeto na raiz do repo (`nio.json`). */
const PROJECT_CONFIG_FILE = brand.projectConfigFile;

/**
 * IDE do usuário — habilita integrações (ex.: `/implement` registra o worktree no
 * editor; o `IdeGateway` abre a pasta no editor). Superset alinhado ao
 * `Session.ide` (`terminal|vscode|cursor|other`) + `xcode` (só integração do
 * `/implement`, que o `Session.ide` colapsa em `other`).
 */
export type Ide = 'vscode' | 'cursor' | 'xcode' | 'terminal' | 'other';

/** Fonte única dos valores de `Ide` — usada pelos guards de parse (sem literais repetidos). */
export const IDE_VALUES: readonly Ide[] = ['vscode', 'cursor', 'xcode', 'terminal', 'other'];

/** Type guard de `Ide` — narra `unknown` (JSON parseado) pro union. */
export function isIde(value: unknown): value is Ide {
  return typeof value === 'string' && (IDE_VALUES as readonly string[]).includes(value);
}

export interface ProjectConfig {
  /**
   * Projeto do NOS vinculado. **Opcional**: um `nio init` sem credenciais (auth
   * pausada até o backend de logs) grava um `nio.json` só com setup local
   * (selection/clientes), sem binding. As tools MCP resolvem/erram por conta
   * própria quando falta (ver `resolveProjectConfig`).
   */
  project_id?: string;
  repository_id?: string | null;
  /**
   * `Session` v2 vinculada (UUID, `sessions.id`). Gravado pelo `nio init` novo —
   * substitui `project_id`/`repository_id` como binding — esses ficam só como
   * campos legados.
   */
  session_id?: string;
  /** Seleção unificada role → área → stack (`nio init`). Dita skills, rules e deps. */
  selection?: Selection;
  /** IDE escolhido no `nio init` — dirige integrações específicas de editor. */
  ide?: Ide;
}

/**
 * Config **do usuário** (por-máquina) — vive em `nio.user.json`, gitignored. Separado
 * do binding/seleção do repo (`nio.json`, versionado do time). O `ProjectConfig`
 * efetivo é o merge dos dois: o repo dá `project_id`/`selection`, o user dá `ide`.
 */
export interface UserConfig {
  ide?: Ide;
}

/** Arquivo de config do usuário — `nio.json` → `nio.user.json` (respeita o brand). */
export const USER_CONFIG_FILE = PROJECT_CONFIG_FILE.replace(/\.json$/, ".user.json");

export function getUserConfigPath(cwd: string = process.cwd()): string {
  const base = isAbsolute(cwd) ? cwd : join(process.cwd(), cwd);
  return join(base, USER_CONFIG_FILE);
}

/** Lê o `ide` do `nio.user.json` em `dir`, se houver (parse tolerante). */
function readUserIde(dir: string): Ide | undefined {
  const path = join(dir, USER_CONFIG_FILE);
  if (!existsSync(path)) return undefined;
  try {
    const u = JSON.parse(readFileSync(path, "utf8")) as { ide?: unknown };
    if (isIde(u.ide)) return u.ide;
  } catch {
    /* user file inválido → ignora */
  }
  return undefined;
}

/** Parse leniente do bloco `selection` do nio.json. */
function parseSelection(value: unknown): Selection | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const s = value as { roles?: unknown; stacks?: unknown };
  const roles = Array.isArray(s.roles)
    ? s.roles.filter((r): r is string => typeof r === 'string' && r.length > 0)
    : [];
  const stacks: Record<string, string> = {};
  if (s.stacks && typeof s.stacks === 'object') {
    for (const [area, stack] of Object.entries(s.stacks as Record<string, unknown>)) {
      if (typeof stack === 'string' && stack.trim()) stacks[area] = stack.trim();
    }
  }
  if (roles.length === 0 && Object.keys(stacks).length === 0) return undefined;
  return { roles, stacks };
}

/**
 * Migra o formato antigo (`sections: {profiles, fields}` + `rules: {área: stack}`) pra
 * a `selection` unificada. `developer`→`dev`, `other`→`management`; cada field vira uma
 * área com a stack do mapa `rules` (ou `general` se não houver). Retorna `undefined` se
 * não há nada antigo.
 */
function migrateLegacySelection(obj: Record<string, unknown>): Selection | undefined {
  const sec = obj.sections as { profiles?: unknown; fields?: unknown } | undefined;
  const oldRules = (obj.rules ?? {}) as Record<string, unknown>;
  if (!sec || typeof sec !== 'object') return undefined;
  const roles: string[] = [];
  const profiles = Array.isArray(sec.profiles) ? sec.profiles : [];
  if (profiles.includes('developer')) roles.push(DEV_ROLE);
  if (profiles.includes('other')) roles.push('management');
  const stacks: Record<string, string> = {};
  const fields = Array.isArray(sec.fields) ? sec.fields : [];
  for (const f of fields) {
    if (typeof f !== 'string') continue;
    const stack = oldRules[f];
    stacks[f] = typeof stack === 'string' && stack.trim() ? stack.trim() : GENERAL;
  }
  if (roles.length === 0 && Object.keys(stacks).length === 0) return undefined;
  return { roles, stacks };
}

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function getProjectConfigPath(cwd: string = process.cwd()): string {
  return isAbsolute(cwd) ? join(cwd, PROJECT_CONFIG_FILE) : join(process.cwd(), cwd, PROJECT_CONFIG_FILE);
}

/**
 * Acha o `nio.json` subindo de `cwd` até a raiz — assim um agente rodando numa
 * subpasta (ex.: `proj-x/backend/src`) ainda encontra o binding em `proj-x/backend`
 * ou `proj-x`. O mais próximo vence (binding do repo tem precedência sobre o do pai).
 */
export function findProjectConfigPath(cwd: string = process.cwd()): string | null {
  let dir = isAbsolute(cwd) ? cwd : join(process.cwd(), cwd);
  for (;;) {
    const candidate = join(dir, PROJECT_CONFIG_FILE);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * ProjectConfig a partir de NIO_PROJECT_ID / NIO_REPOSITORY_ID — override
 * opcional pro env do cliente MCP. O Cowork NÃO usa isto (projeto é por sessão).
 * Retorna null se NIO_PROJECT_ID não estiver definido.
 */
function loadProjectConfigFromEnv(): ProjectConfig | null {
  const projectId = env('PROJECT_ID')?.trim();
  if (!projectId) return null;

  if (!UUID_REGEX.test(projectId)) {
    throw new Error('NIO_PROJECT_ID não é um UUID válido.');
  }

  const config: ProjectConfig = { project_id: projectId };
  const repositoryId = env('REPOSITORY_ID')?.trim();
  if (repositoryId) {
    if (!UUID_REGEX.test(repositoryId)) {
      throw new Error('NIO_REPOSITORY_ID deve ser um UUID válido.');
    }
    config.repository_id = repositoryId;
  }
  return config;
}

/** Lê e faz `JSON.parse` do `nio.json` em `path` — erros viram mensagens com o nome do arquivo. */
function readProjectConfigFile(path: string): Record<string, unknown> {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(`Não foi possível ler ${PROJECT_CONFIG_FILE}: ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${PROJECT_CONFIG_FILE} contém JSON inválido: ${(err as Error).message}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`${PROJECT_CONFIG_FILE} deve conter um objeto JSON.`);
  }
  return parsed as Record<string, unknown>;
}

/** Valida e monta o `ProjectConfig` a partir do objeto já parseado do `nio.json`. */
function shapeProjectConfig(obj: Record<string, unknown>): ProjectConfig {
  const projectId = obj.project_id;
  if (projectId !== undefined && (typeof projectId !== 'string' || !UUID_REGEX.test(projectId))) {
    throw new Error(`${PROJECT_CONFIG_FILE}: campo "project_id", quando presente, deve ser um UUID válido.`);
  }

  const repositoryId = obj.repository_id;
  if (
    repositoryId !== undefined &&
    repositoryId !== null &&
    (typeof repositoryId !== 'string' || !UUID_REGEX.test(repositoryId))
  ) {
    throw new Error(`${PROJECT_CONFIG_FILE}: campo "repository_id" deve ser UUID, null ou ausente.`);
  }

  const sessionId = obj.session_id;
  if (sessionId !== undefined && (typeof sessionId !== 'string' || !UUID_REGEX.test(sessionId))) {
    throw new Error(`${PROJECT_CONFIG_FILE}: campo "session_id", quando presente, deve ser um UUID válido.`);
  }

  const config: ProjectConfig = {};
  if (typeof projectId === 'string') config.project_id = projectId;
  if (typeof repositoryId === 'string') {
    config.repository_id = repositoryId;
  } else if (repositoryId === null) {
    config.repository_id = null;
  }
  if (typeof sessionId === 'string') config.session_id = sessionId;
  const selection = parseSelection(obj.selection) ?? migrateLegacySelection(obj);
  if (selection) config.selection = selection;
  if (isIde(obj.ide)) config.ide = obj.ide;
  return config;
}

export function loadProjectConfig(cwd: string = process.cwd()): ProjectConfig | null {
  // Precedência pro ambiente (Desktop Extension / Cowork não têm nio.json no cwd).
  const envConfig = loadProjectConfigFromEnv();
  if (envConfig) return envConfig;

  const path = findProjectConfigPath(cwd);
  if (!path) return null;

  const config = shapeProjectConfig(readProjectConfigFile(path));
  // Prefs do usuário (`nio.user.json`, ao lado do repo file) sobrepõem o `ide`.
  const userIde = readUserIde(dirname(path));
  if (userIde) config.ide = userIde;
  return config;
}

/**
 * Grava o `nio.json` **do repo** (versionado): binding + seleção. **Não** grava `ide`
 * (isso é do usuário → `writeUserConfig`).
 */
export function writeProjectConfig(config: ProjectConfig, cwd: string = process.cwd()): void {
  const repo: Record<string, unknown> = {};
  if (config.project_id) repo.project_id = config.project_id;
  if (config.repository_id !== undefined) repo.repository_id = config.repository_id;
  if (config.session_id) repo.session_id = config.session_id;
  if (config.selection) repo.selection = config.selection;
  writeFileSync(getProjectConfigPath(cwd), JSON.stringify(repo, null, 2) + "\n", "utf8");
}

/** Grava o `nio.user.json` (por-máquina, gitignored): ide + prefs pessoais. */
export function writeUserConfig(user: UserConfig, cwd: string = process.cwd()): void {
  const obj: Record<string, unknown> = {};
  if (user.ide) obj.ide = user.ide;
  writeFileSync(getUserConfigPath(cwd), JSON.stringify(obj, null, 2) + "\n", "utf8");
}

/**
 * Migra o formato antigo monolítico: se o `nio.json` ainda tem `ide`, move pro
 * `nio.user.json` e reescreve o `nio.json` sem ele. Idempotente. `true` se migrou.
 */
export function migrateConfigSplit(cwd: string = process.cwd()): boolean {
  const repoPath = getProjectConfigPath(cwd);
  if (!existsSync(repoPath)) return false;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(readFileSync(repoPath, "utf8")) as Record<string, unknown>;
  } catch {
    return false;
  }
  if (!("ide" in obj)) return false;

  const ide = obj.ide;
  delete obj.ide;
  delete obj.sections; // resquícios do formato ainda mais antigo
  delete obj.rules;
  writeFileSync(repoPath, JSON.stringify(obj, null, 2) + "\n", "utf8");

  if (isIde(ide) && !readUserIde(cwd)) {
    writeUserConfig({ ide }, cwd);
  }
  return true;
}

function readGitignore(cwd: string): { path: string; text: string } {
  const path = join(cwd, ".gitignore");
  return { path, text: existsSync(path) ? readFileSync(path, "utf8") : "" };
}

// Sufixos ESTÁVEIS dos marcadores do `.gitignore`. O prefixo é a marca (`# nio`),
// que muda num rebrand — então casamos por sufixo pra reconhecer/limpar o marcador de
// QUALQUER marca (é a migração que remove o marcador antigo).
const GITIGNORE_USER_SUFFIX = "(config local do usuário)";
const GITIGNORE_PROJECT_SUFFIX = "(binding local do projeto)";

/** Linha é um marcador nosso do sufixo dado? Agnóstico à marca. */
function isGitignoreMarker(line: string, suffix: string): boolean {
  const t = line.trim();
  return t.startsWith("#") && t.endsWith(suffix);
}

/** Garante uma entrada no `.gitignore` (idempotente). Cria o arquivo se não existir. */
export function ensureGitignored(
  entry: string = USER_CONFIG_FILE,
  cwd: string = process.cwd(),
): "added" | "present" {
  const { path, text } = readGitignore(cwd);
  const marker = `# ${brand.name} ${GITIGNORE_USER_SUFFIX}`;
  // Migração: varre marcadores de usuário de outra marca (preserva o atual).
  const kept = text
    .split(/\r?\n/)
    .filter((l) => l.trim() === marker || !isGitignoreMarker(l, GITIGNORE_USER_SUFFIX));
  const base = kept.join("\n");

  if (kept.some((l) => l.trim() === entry)) {
    if (base !== text) writeFileSync(path, base, "utf8"); // persiste a limpeza
    return "present";
  }
  const sep = base.length > 0 && !base.endsWith("\n") ? "\n" : "";
  const block = `${sep}${base.length > 0 ? "\n" : ""}${marker}\n${entry}\n`;
  writeFileSync(path, base + block, "utf8");
  return "added";
}

/** Remove uma entrada exata do `.gitignore` (+ o marcador de projeto órfão, de qualquer marca). `true` se removeu. */
export function removeFromGitignore(entry: string, cwd: string = process.cwd()): boolean {
  const { path, text } = readGitignore(cwd);
  if (!text) return false;
  const lines = text.split(/\r?\n/);
  const kept = lines.filter(
    (l) => l.trim() !== entry && !isGitignoreMarker(l, GITIGNORE_PROJECT_SUFFIX),
  );
  if (kept.length === lines.length) return false;
  writeFileSync(path, kept.join("\n"), "utf8");
  return true;
}

/**
 * Ajusta o `.gitignore` pro split: tira o `nio.json` (agora versionado, do time) e
 * garante o `nio.user.json` (do usuário) ignorado. Retorna se acrescentou o user file.
 */
export function fixGitignoreForSplit(cwd: string = process.cwd()): "added" | "present" {
  removeFromGitignore(PROJECT_CONFIG_FILE, cwd);
  return ensureGitignored(USER_CONFIG_FILE, cwd);
}
