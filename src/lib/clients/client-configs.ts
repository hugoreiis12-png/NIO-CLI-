// Configuração do client (opencode; vscode usa só .vscode/mcp.json)
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupFile, readJson, writeJson } from '../file-merge.js';
import { brand, envName, env } from '../../brand.js';
import type { McpSpec } from '../../core/environment.js';

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

interface OpencodeServerEntry {
  type?: string;
  command?: string[];
  url?: string;
  environment?: Record<string, string>;
  enabled?: boolean;
}

/**
 * Motor de IA da CLI (ver `docs/arch/ARQUITETURA-CLIENTE-IA.md`). O NIO **não** roteia
 * mais pelo provider `opencode` (Zen) — esse fica no default dele (big-pickle) e sem
 * competência sobre o motor da CLI. Em vez disso, o NIO semeia um **provider dedicado**
 * (`NIO_AI_PROVIDER`, OpenAI-compatível) que fala DIRETO no backend, e é ESSE o `model`
 * default. Assim o OpenCode vira só o runtime (serve/TUI/SDK), não o motor.
 */
export const NIO_AI_PROVIDER = env('AI_PROVIDER')?.trim() || 'nio-local';

/** Id do modelo **exatamente como o backend serve** (sem prefixo de provider). Override `NIO_AI_MODEL`. */
export const NIO_AI_MODEL_ID = env('AI_MODEL')?.trim() || 'RedHatAI/Qwen3.8-27B-INT4';

/** Ref completo `<provider>/<id>` gravado no `model` do `opencode.json` e usado no `opencode run`. */
export const NIO_OPERATOR_MODEL = `${NIO_AI_PROVIDER}/${NIO_AI_MODEL_ID}`;

/**
 * baseURL do backend de IA (OpenAI-compatível, `/v1`) que o provider dedicado consome —
 * o SDK anexa `/chat/completions`. Default = vLLM interno; override via `NIO_AI_BASE_URL`.
 */
export const NIO_AI_BASE_URL = env('AI_BASE_URL')?.trim() || 'http://192.168.0.140:8001/v1';

/** Lê um env numérico (`NIO_<name>`); vazio/ausente/inválido → `dflt`. `0` é honrado. */
function envNum(name: string, dflt: number): number {
  const raw = env(name)?.trim();
  if (!raw) return dflt;
  const n = Number(raw);
  return Number.isFinite(n) ? n : dflt;
}

/**
 * Janela de contexto (tokens) do modelo do backend de IA, **declarada** no provider
 * (`provider.opencode.models.<id>.limit`). O OpenCode só aceita/orça um modelo fora
 * do catálogo Zen se ele estiver declarado — sem isto, um id de vLLM/local vira
 * "Model not found". Default 65536 (o vLLM local); override `NIO_AI_CONTEXT`.
 * `NIO_AI_CONTEXT=0` desativa a declaração (usa o catálogo do provider).
 */
export const NIO_AI_CONTEXT = envNum('AI_CONTEXT', 65536);

/** Teto de tokens de saída reservados dentro da janela. Override `NIO_AI_OUTPUT`. */
export const NIO_AI_OUTPUT = envNum('AI_OUTPUT', 2048);

/**
 * Teto de tokens de **input** por prompt (hard cap). Prompts acima disso são
 * recusados antes do `fetch` (ver `qwenComplete`) — com schemas de MCP pesados,
 * o boot do `nio ai` estourava os 65536 da janela mesmo com output baixo.
 * Override `NIO_AI_MAX_INPUT`. `0` desativa a trava.
 */
export const NIO_AI_MAX_INPUT = envNum('AI_MAX_INPUT', 32000);

/**
 * Compaction automática do OpenCode: com a janela apertada (64K num backend local +
 * schemas de MCP pesados), deixa o motor compactar/podar o histórico sozinho,
 * reservando `reserved` tokens pro resumo. Só semeado se ausente (não sobrescreve).
 */
export const DEFAULT_OPENCODE_COMPACTION: Record<string, unknown> = {
  auto: true,
  prune: true,
  reserved: 8000,
};

/** Watcher: ignora dirs volumosos (não dispara reindex/eventos à toa). Só se ausente. */
export const DEFAULT_OPENCODE_WATCHER: Record<string, unknown> = {
  ignore: ['node_modules/**', '.git/**', 'dist/**', 'build/**', 'coverage/**'],
};

/**
 * Defaults de permissão do `opencode.json` (Sprint 7.5 de UI/UX). Libera os
 * comandos de shell só-leitura (o grosso dos prompts na TUI) e mantém `ask` pro
 * resto: edições, rede, e qualquer bash fora da allowlist. Só é semeado quando
 * o config ainda não tem um bloco `permission` (nunca sobrescreve o do usuário).
 */
export const DEFAULT_OPENCODE_PERMISSION: Record<string, unknown> = {
  bash: {
    'ls *': 'allow', ls: 'allow', pwd: 'allow', whoami: 'allow', date: 'allow',
    'cat *': 'allow', 'head *': 'allow', 'tail *': 'allow', 'wc *': 'allow',
    'file *': 'allow', 'stat *': 'allow', 'which *': 'allow', 'echo *': 'allow',
    'find *': 'allow', 'grep *': 'allow', 'rg *': 'allow', 'tree *': 'allow',
    'git status*': 'allow', 'git log*': 'allow', 'git diff*': 'allow',
    'git show*': 'allow', 'git branch*': 'allow', 'git remote*': 'allow',
    'git rev-parse*': 'allow',
    '*': 'ask',
  },
  edit: 'ask',
  webfetch: 'ask',
  external_directory: 'ask',
};

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

interface OpencodeModelEntry {
  name?: string;
  limit?: { context?: number; output?: number };
  [k: string]: unknown;
}

interface OpencodeProviderEntry {
  npm?: string;
  name?: string;
  options?: Record<string, unknown>;
  models?: Record<string, OpencodeModelEntry | undefined>;
}

/**
 * Semeia o **provider dedicado** do motor de IA da CLI (`provider.<id>`, OpenAI-compatível
 * via `@ai-sdk/openai-compatible`) apontando DIRETO no backend (`baseURL`) e declarando o
 * modelo (`modelId`) com seu limite de contexto. Isto **não** toca o provider `opencode` —
 * ele fica no default (big-pickle), fora do motor da CLI. Preserva campos/modelos já
 * presentes no provider. Pura, sem IO.
 */
export function planNioAiProvider(
  existing: Record<string, unknown>,
  provider: string,
  baseURL: string,
  modelId: string,
  context: number,
  output: number,
): Record<string, unknown> {
  const providers = { ...((existing.provider ?? {}) as Record<string, OpencodeProviderEntry | undefined>) };
  const cur = providers[provider] ?? {};
  const models = { ...(cur.models ?? {}) } as Record<string, OpencodeModelEntry>;
  const limit = context > 0 ? { ...models[modelId]?.limit, context, output } : models[modelId]?.limit;
  models[modelId] = { name: 'NIO local (vLLM)', ...models[modelId], ...(limit ? { limit } : {}) };
  providers[provider] = {
    ...cur,
    npm: cur.npm ?? '@ai-sdk/openai-compatible',
    name: cur.name ?? 'NIO local (vLLM)',
    options: { ...cur.options, baseURL, apiKey: (cur.options?.apiKey as string | undefined) ?? 'local' },
    models,
  };
  return { ...existing, provider: providers };
}

/** O provider dedicado já está OK? (existe, baseURL bate, e o modelo tem o limite pedido). */
function nioAiProviderOk(
  existing: Record<string, unknown>,
  provider: string,
  baseURL: string,
  modelId: string,
  context: number,
  output: number,
): boolean {
  const p = (existing.provider as Record<string, OpencodeProviderEntry | undefined> | undefined)?.[provider];
  if (!p || p.options?.baseURL !== baseURL) return false;
  if (context <= 0) return Boolean(p.models?.[modelId]);
  const lim = p.models?.[modelId]?.limit;
  return lim?.context === context && lim?.output === output;
}

/** Tem um `baseURL` de provider `opencode` gravado? (legado do hijack — não deve mais ter). */
function opencodeHasBaseURL(existing: Record<string, unknown>): boolean {
  const p = (existing.provider as { opencode?: OpencodeProviderEntry } | undefined)?.opencode;
  return p?.options?.baseURL !== undefined;
}

/**
 * Remove o `baseURL` do provider `opencode` (Headroom DESATIVADO — client fala direto
 * no OpenCode Zen). Limpa `options`/`provider.opencode` que ficarem vazios. Pura, sem IO.
 */
export function clearOpencodeProviderBaseURL(existing: Record<string, unknown>): Record<string, unknown> {
  const providers = existing.provider as Record<string, OpencodeProviderEntry | undefined> | undefined;
  const cur = providers?.opencode;
  if (cur?.options?.baseURL === undefined) return existing; // nada a limpar
  const restOptions: Record<string, unknown> = { ...cur.options };
  delete restOptions.baseURL; // Record plano → delete permitido
  // `options: undefined` some no JSON.stringify (chaves undefined são omitidas).
  const opencode: OpencodeProviderEntry =
    Object.keys(restOptions).length > 0 ? { ...cur, options: restOptions } : { ...cur, options: undefined };
  return { ...existing, provider: { ...providers, opencode } };
}

/**
 * Decide se o `nio` (+ os MCPs do perfil) já estão OK no `opencode.json` e monta
 * o próximo objeto se precisar atualizar (pura, sem IO). O OpenCode usa `mcp`
 * (não `mcpServers`/`mcp_servers`), `command` como array (binário + args juntos)
 * e `environment` (não `env`). Também garante o `model` default
 * (`NIO_OPERATOR_MODEL`) no nível raiz.
 */
export function planOpencodeUpdate(
  existing: Record<string, unknown>,
  nioEntry: { command: string[]; environment: Record<string, string> },
  profileMcps: McpSpec[] = [],
  baseURL?: string,
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
  // Motor = provider dedicado (NIO_AI_PROVIDER) direto no backend. Com baseURL, ele
  // precisa existir com o modelo+limite declarados; sem baseURL, o opencode não deve
  // ter baseURL de hijack legado (fica no default big-pickle).
  const providerOk = baseURL
    ? nioAiProviderOk(existing, NIO_AI_PROVIDER, baseURL, NIO_AI_MODEL_ID, NIO_AI_CONTEXT, NIO_AI_OUTPUT)
    : !opencodeHasBaseURL(existing);
  const alreadyConfigured =
    nioOk &&
    existing.model === NIO_OPERATOR_MODEL &&
    mcpsOk &&
    providerOk &&
    Boolean(existing.permission) &&
    Boolean(existing.compaction) &&
    Boolean(existing.watcher);

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

  let next: Record<string, unknown> = { ...existing, model: NIO_OPERATOR_MODEL, mcp: nextMcp };
  if (!existing.permission) next.permission = DEFAULT_OPENCODE_PERMISSION; // Sprint 7.5 — nunca sobrescreve
  if (!existing.compaction) next.compaction = DEFAULT_OPENCODE_COMPACTION; // janela apertada — nunca sobrescreve
  if (!existing.watcher) next.watcher = DEFAULT_OPENCODE_WATCHER; // nunca sobrescreve
  next = clearOpencodeProviderBaseURL(next); // limpa qualquer hijack legado no provider `opencode`
  if (baseURL) next = planNioAiProvider(next, NIO_AI_PROVIDER, baseURL, NIO_AI_MODEL_ID, NIO_AI_CONTEXT, NIO_AI_OUTPUT);
  return { alreadyConfigured, next };
}

/** Path global do `opencode.json` (~/.config/opencode). Seam pra teste. */
export function opencodeGlobalPath(): string {
  return join(homedir(), '.config', 'opencode', 'opencode.json');
}

/**
 * `~/.config/opencode/opencode.json` — registro global do MCP `nio` + os MCPs do
 * perfil (`profileMcps`, do `EnvironmentBuilder`). Sem perfil, escreve só o `nio`
 * (comportamento anterior preservado). Semeia o provider dedicado `NIO_AI_PROVIDER`
 * apontando pro backend de IA direto (`baseURL`, default `NIO_AI_BASE_URL`) e grava
 * `model: NIO_OPERATOR_MODEL` no nível raiz — o `opencode` vira só o runtime, não o
 * motor (ver `docs/arch/ARQUITETURA-CLIENTE-IA.md`). Passe `''` pra não semear
 * provider (fica no default big-pickle). `path` é seam opcional (default = global)
 * pra teste não tocar no arquivo real do usuário.
 */
export function installOpencodeGlobal(
  profileMcps: McpSpec[] = [],
  path = opencodeGlobalPath(),
  baseURL: string | undefined = NIO_AI_BASE_URL,
): InstallResult {
  // `NIO_CLIENT=opencode` avisa o servidor MCP a (1) provisionar/auto-pull pra
  // `~/.config/opencode` e (2) filtrar os docs pelo surface `opencode`.
  const nioEntry = { command: [MCP_COMMAND], environment: { [envName('CLIENT')]: 'opencode' } };

  if (!existsSync(path)) {
    const { next } = planOpencodeUpdate({}, nioEntry, profileMcps, baseURL);
    writeJson(path, next);
    return { status: 'created', path };
  }

  const existing = readJsonSafe(path) ?? {};
  const { alreadyConfigured, next } = planOpencodeUpdate(existing, nioEntry, profileMcps, baseURL);
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
