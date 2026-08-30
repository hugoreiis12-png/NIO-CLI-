// Configuração do client (opencode, vscode , claude code)
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupFile, readJson, writeJson, readToml, writeToml } from './file-merge.js';
import { brand, envName } from '../brand.js';
import type { McpSpec } from '../core/environment.js';

const MCP_COMMAND = brand.mcpBinName;

export type InstallStatus = 'created' | 'updated' | 'already_configured';

export interface InstallResult {
  status: InstallStatus;
  path: string;
  backup?: string;
}

interface McpServerEntry {
  command: string;
}

/**
 * Lê o JSON do path; se for malformado, lança erro com mensagem clara
 * apontando que o user deve consertar à mão.
 */
function readJsonSafe(path: string): Record<string, unknown> | null {
  try {
    return readJson(path) as Record<string, unknown> | null;
  } catch (err) {
    throw new Error(
      `Arquivo ${path} contém JSON inválido (${(err as Error).message}). ` +
        `Conserte ou apague antes de rodar de novo.`,
    );
  }
}

function ensureMcpServersJson(
  path: string,
  rootKey: 'mcpServers' | 'servers',
): InstallResult {
  if (!existsSync(path)) {
    writeJson(path, { [rootKey]: { [brand.mcpServerKey]: { command: MCP_COMMAND } } });
    return { status: 'created', path };
  }

  const existing = (readJsonSafe(path) ?? {}) as Record<string, unknown>;
  const root = (existing[rootKey] ?? {}) as Record<string, McpServerEntry | undefined>;
  const current = root[brand.mcpServerKey];

  if (current && current.command === MCP_COMMAND) {
    return { status: 'already_configured', path };
  }

  const backup = backupFile(path);
  const next = {
    ...existing,
    [rootKey]: {
      ...root,
      [brand.mcpServerKey]: { command: MCP_COMMAND },
    },
  };
  writeJson(path, next);
  return { status: 'updated', path, backup };
}

export function installClaudeCodeGlobal(): InstallResult {
  const path = join(homedir(), '.claude', 'settings.json');
  return ensureMcpServersJson(path, 'mcpServers');
}

export function installClaudeCodeRepo(cwd: string): InstallResult {
  const path = join(cwd, '.mcp.json');
  return ensureMcpServersJson(path, 'mcpServers');
}

export function installVSCodeRepo(cwd: string): InstallResult {
  const path = join(cwd, '.vscode', 'mcp.json');
  return ensureMcpServersJson(path, 'servers');
}

// ---------------------------------------------------------------------------
// Claude Desktop / Cowork — ativa o conector direto no config, sem `.mcpb`.
// ---------------------------------------------------------------------------

/** Diretório de config do Claude Desktop por SO (criado pelo app quando instalado). */
export function coworkConfigDir(): string {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Claude');
  }
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Claude');
  }
  return join(homedir(), '.config', 'Claude');
}

export function coworkConfigPath(): string {
  return join(coworkConfigDir(), 'claude_desktop_config.json');
}

/** O app está instalado? Presença do dir de config é o sinal (o app o cria). */
export function coworkAppInstalled(): boolean {
  return existsSync(coworkConfigDir());
}

/** O conector nio já está no `claude_desktop_config.json`? */
export function coworkConfigured(): boolean {
  const path = coworkConfigPath();
  if (!existsSync(path)) return false;
  try {
    const json = (readJsonSafe(path) ?? {}) as { mcpServers?: Record<string, unknown> };
    return Boolean(json.mcpServers?.[brand.mcpServerKey]);
  } catch {
    return false;
  }
}

/** Path absoluto do `dist/mcp-server.js` deste pacote (compila pra `dist/lib/`). */
function mcpServerJsPath(): string {
  const here = dirname(fileURLToPath(import.meta.url)); // .../dist/lib
  return join(here, '..', 'mcp-server.js'); // .../dist/mcp-server.js
}

interface CoworkEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * Ativa o conector nio direto no `claude_desktop_config.json` do Claude Desktop.
 *
 * Usa caminhos ABSOLUTOS (`process.execPath` + `dist/mcp-server.js`) porque o app é
 * GUI e tem PATH mínimo — `nio-cli`/`node` via nvm não seriam encontrados. O PAT
 * vem do `~/.nio/credentials.json` (via `nio login`); `NIO_CLIENT=cowork`
 * faz o server servir as skills por prompts/resources e escolher projeto por sessão.
 * Não-destrutivo: faz merge + backup do config existente.
 */
export function installCoworkGlobal(): InstallResult {
  const path = coworkConfigPath();
  const entry: CoworkEntry = {
    command: process.execPath,
    args: [mcpServerJsPath()],
    env: { [envName('CLIENT')]: 'cowork' },
  };

  if (!existsSync(path)) {
    writeJson(path, { mcpServers: { [brand.mcpServerKey]: entry } });
    return { status: 'created', path };
  }

  const existing = (readJsonSafe(path) ?? {}) as Record<string, unknown>;
  const root = (existing.mcpServers ?? {}) as Record<string, CoworkEntry | undefined>;
  const current = root[brand.mcpServerKey];

  if (
    current &&
    current.command === entry.command &&
    current.args?.[0] === entry.args?.[0] &&
    current.env?.[envName('CLIENT')] === 'cowork'
  ) {
    return { status: 'already_configured', path };
  }

  const backup = backupFile(path);
  writeJson(path, { ...existing, mcpServers: { ...root, [brand.mcpServerKey]: entry } });
  return { status: 'updated', path, backup };
}

// O Claude Code injeta "Co-Authored-By: Claude" nos commits por padrão; em repos
// de cliente isso suja o histórico. Estas funções leem/desligam esse knob global.
export interface CoAuthoredByStatus {
  path: string;
  /** Valor atual de includeCoAuthoredBy; undefined = não setado (Claude Code assume ligado). */
  value: boolean | undefined;
  /** true se os commits ganham o trailer (setado true ou ausente). */
  enabled: boolean;
}

function claudeSettingsPath(): string {
  return join(homedir(), '.claude', 'settings.json');
}

export function readCoAuthoredBy(path = claudeSettingsPath()): CoAuthoredByStatus {
  if (!existsSync(path)) return { path, value: undefined, enabled: true };
  const json = (readJsonSafe(path) ?? {}) as { includeCoAuthoredBy?: boolean };
  const value = json.includeCoAuthoredBy;
  return { path, value, enabled: value !== false };
}

// ponytail: setamos só includeCoAuthoredBy=false (knob simples, ainda honrado).
// Se o Claude Code um dia remover em favor do `attribution`, migra aqui.
export function disableCoAuthoredBy(path = claudeSettingsPath()): InstallResult {
  const exists = existsSync(path);
  const existing = exists ? (readJsonSafe(path) ?? {}) : {};
  const backup = exists ? backupFile(path) : undefined;
  writeJson(path, { ...existing, includeCoAuthoredBy: false });
  return { status: exists ? 'updated' : 'created', path, backup };
}

interface CodexServerEntry {
  command?: string;
  env?: Record<string, string>;
}

/**
 * Decide se o `nio` já está OK no TOML e monta o próximo objeto se precisar
 * atualizar (pura, sem IO). Já-OK só se command bate E env NIO_CLIENT=codex já
 * existe — senão atualiza (instalações antigas ganham o env no próximo run).
 */
export function planCodexUpdate(
  existing: Record<string, unknown>,
  nioEntry: { command: string; env: Record<string, string> },
): { alreadyConfigured: boolean; next: Record<string, unknown> } {
  const servers = (existing.mcp_servers ?? {}) as Record<string, CodexServerEntry | undefined>;
  const current = servers[brand.mcpServerKey];

  const alreadyConfigured = Boolean(
    current && current.command === MCP_COMMAND && current.env?.[envName('CLIENT')] === 'codex',
  );

  const next: Record<string, unknown> = {
    ...existing,
    mcp_servers: {
      ...servers,
      [brand.mcpServerKey]: {
        ...current,
        ...nioEntry,
        env: { ...current?.env, [envName('CLIENT')]: 'codex' },
      },
    },
  };
  return { alreadyConfigured, next };
}

interface OpencodeServerEntry {
  type?: string;
  command?: string[];
  url?: string;
  environment?: Record<string, string>;
  enabled?: boolean;
}

/**
 * Modelo fixo do operador de IA embutido (ver `docs/v2/ARQUITETURA-CLIENTE-IA.md`).
 * É só um DEFAULT no `opencode.json` — o OpenCode não trava modelo de
 * verdade a nível de config de projeto/global (limitação documentada, não
 * finja que é um lock forte).
 */
export const NIO_OPERATOR_MODEL = 'opencode/big-pickle';

/** Monta a entrada OpenCode de um MCP, preservando campos do usuário. Remoto (`spec.url`) → `type: 'remote'`. */
function opencodeMcpEntry(spec: McpSpec, current?: OpencodeServerEntry): OpencodeServerEntry {
  if (spec.url) {
    return { type: 'remote', ...current, url: spec.url, enabled: true };
  }
  const entry: OpencodeServerEntry = {
    type: 'local',
    ...current,
    command: spec.command,
    enabled: true,
  };
  if (spec.environment) {
    entry.environment = { ...current?.environment, ...spec.environment };
  }
  return entry;
}

/** Uma entrada de MCP já está OK no `opencode.json`? (command/url batem, não desabilitada) */
function opencodeMcpOk(spec: McpSpec, cur?: OpencodeServerEntry): boolean {
  if (!cur || cur.enabled === false) return false;
  return spec.url ? cur.url === spec.url : cur.command?.[0] === spec.command?.[0];
}

/**
 * Decide se o `nio` (+ os MCPs do perfil) já estão OK no `opencode.json` e monta
 * o próximo objeto se precisar atualizar (pura, sem IO). Mesmo padrão de
 * `planCodexUpdate`, mas o OpenCode usa `mcp` (não `mcpServers`/`mcp_servers`),
 * `command` como array (binário + args juntos) e `environment` (não `env`).
 * Também garante o `model` default (`NIO_OPERATOR_MODEL`) no nível raiz.
 * 
 */
export function planOpencodeUpdate(
  existing: Record<string, unknown>,
  nioEntry: { command: string[]; environment: Record<string, string> },
  profileMcps: McpSpec[] = [],
): { alreadyConfigured: boolean; next: Record<string, unknown> } {
  const servers = (existing.mcp ?? {}) as Record<string, OpencodeServerEntry | undefined>;
  const current = servers[brand.mcpServerKey];

  const nioOk = Boolean(
    current &&
      current.command?.[0] === nioEntry.command[0] &&
      current.environment?.[envName('CLIENT')] === 'opencode' &&
      current.enabled !== false,
  );
  const mcpsOk = profileMcps.every((spec) => opencodeMcpOk(spec, servers[spec.id]));
  const alreadyConfigured = nioOk && existing.model === NIO_OPERATOR_MODEL && mcpsOk;

  const nextMcp: Record<string, OpencodeServerEntry> = {
    ...(servers as Record<string, OpencodeServerEntry>),
    [brand.mcpServerKey]: {
      type: 'local',
      ...current,
      command: nioEntry.command,
      environment: { ...current?.environment, [envName('CLIENT')]: 'opencode' },
      enabled: true,
    },
  };
  for (const spec of profileMcps) {
    nextMcp[spec.id] = opencodeMcpEntry(spec, servers[spec.id]);
  }

  const next: Record<string, unknown> = {
    ...existing,
    model: NIO_OPERATOR_MODEL,
    mcp: nextMcp,
  };
  return { alreadyConfigured, next };
}

/** Path global do `opencode.json` (~/.config/opencode). Seam pra teste. */
export function opencodeGlobalPath(): string {
  return join(homedir(), '.config', 'opencode', 'opencode.json');
}

/**
 * `~/.config/opencode/opencode.json` — registro global do MCP `nio` + os MCPs do
 * perfil (`profileMcps`, do `EnvironmentBuilder`). Sem perfil, escreve só o `nio`
 * (comportamento anterior preservado). `path` é seam opcional (default = global)
 * pra teste não tocar no arquivo real do usuário.
 */
export function installOpencodeGlobal(
  profileMcps: McpSpec[] = [],
  path = opencodeGlobalPath(),
): InstallResult {
  // `NIO_CLIENT=opencode` avisa o servidor MCP a (1) provisionar/auto-pull pra
  // `~/.config/opencode` e (2) filtrar os docs pelo surface `opencode`.
  const nioEntry = { command: [MCP_COMMAND], environment: { [envName('CLIENT')]: 'opencode' } };

  if (!existsSync(path)) {
    const { next } = planOpencodeUpdate({}, nioEntry, profileMcps);
    writeJson(path, next);
    return { status: 'created', path };
  }

  const existing = readJsonSafe(path) ?? {};
  const { alreadyConfigured, next } = planOpencodeUpdate(existing, nioEntry, profileMcps);
  if (alreadyConfigured) return { status: 'already_configured', path };

  const backup = backupFile(path);
  writeJson(path, next);
  return { status: 'updated', path, backup };
}

/**
 * Funde **uma** entrada de MCP no `opencode.json` global (fora do fluxo de
 * perfil) — usado pelo `nio docker toolkit up`. Preserva o resto do arquivo, faz
 * `.bak`. `remove: true` desabilita (`enabled: false`) em vez de fundir.
 */
export function upsertOpencodeMcp(
  spec: McpSpec,
  opts: { remove?: boolean; path?: string } = {},
): InstallResult {
  const path = opts.path ?? opencodeGlobalPath();

  if (!existsSync(path)) {
    if (opts.remove) return { status: 'already_configured', path };
    const servers = { [spec.id]: opencodeMcpEntry(spec) };
    writeJson(path, { mcp: servers });
    return { status: 'created', path };
  }

  const existing = readJsonSafe(path) ?? {};
  const servers = { ...((existing.mcp ?? {}) as Record<string, OpencodeServerEntry>) };
  const cur = servers[spec.id];

  if (opts.remove) {
    if (!cur || cur.enabled === false) return { status: 'already_configured', path };
    servers[spec.id] = { ...cur, enabled: false };
  } else {
    if (opencodeMcpOk(spec, cur)) return { status: 'already_configured', path };
    servers[spec.id] = opencodeMcpEntry(spec, cur);
  }

  const backup = backupFile(path);
  writeJson(path, { ...existing, mcp: servers });
  return { status: 'updated', path, backup };
}

export function installCodexGlobal(): InstallResult {
  const path = join(homedir(), '.codex', 'config.toml');

  // `NIO_CLIENT=codex` avisa o servidor MCP a (1) provisionar/auto-pull pra
  // `~/.codex` (skills + prompts) e (2) filtrar os docs pelo surface `codex`.
  const nioEntry = { command: MCP_COMMAND, env: { [envName('CLIENT')]: 'codex' } };

  if (!existsSync(path)) {
    writeToml(path, { mcp_servers: { [brand.mcpServerKey]: nioEntry } });
    return { status: 'created', path };
  }

  let existing: Record<string, unknown>;
  try {
    existing = (readToml(path) ?? {}) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `Arquivo ${path} contém TOML inválido (${(err as Error).message}). ` +
        `Conserte ou apague antes de rodar de novo.`,
    );
  }

  const { alreadyConfigured, next } = planCodexUpdate(existing, nioEntry);
  if (alreadyConfigured) return { status: 'already_configured', path };

  const backup = backupFile(path);
  writeToml(path, next);
  return { status: 'updated', path, backup };
}
