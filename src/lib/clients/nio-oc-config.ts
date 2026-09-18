/**
 * Config DEDICADO do NIO pro `opencode serve` — isolado do global do usuário.
 *
 * Motivo (medido): a TUI subia o serve contra o `~/.config/opencode` global, que
 * herda TODOS os MCPs pessoais do usuário (excel, powerbi ×2, …) → ~93 tools /
 * ~50k tokens de schema em CADA request → latência. Aqui montamos um config que o
 * opencode lê como "global" via `XDG_CONFIG_HOME` redirecionado, com só os MCPs do
 * perfil. Herda as defs validadas do global (shell/skills/instructions) e **copia**
 * a def dos MCPs listados em `inheritGlobalMcpIds` (ex.: excel) — o usuário não
 * reconfigura nada; o NIO só FILTRA o conjunto ativo.
 */
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { writeJson } from '../file-merge.js';
import { brand, envName } from '../../brand.js';
import type { McpSpec, ProfileDefinition } from '../../core/environment.js';
import { nioLangMcp } from '../../profiles/mcps.js';
import { createProfileCatalog } from '../../profiles/index.js';
import type { Profile } from '../../core/types.js';
import {
  NIO_OPERATOR_MODEL,
  NIO_AI_PROVIDER,
  NIO_AI_MODEL_ID,
  NIO_AI_BASE_URL,
  NIO_AI_CONTEXT,
  NIO_AI_OUTPUT,
  DEFAULT_OPENCODE_PERMISSION,
  DEFAULT_OPENCODE_COMPACTION,
  DEFAULT_OPENCODE_WATCHER,
  planNioAiProvider,
  opencodeGlobalPath,
  readJsonSafe,
} from './client-configs.js';

/** Dir a passar em `XDG_CONFIG_HOME` — o opencode lê `<dir>/opencode/opencode.json`. */
export function nioXdgConfigDir(): string {
  return join(homedir(), '.nio', 'oc');
}

/** Caminho do arquivo do config dedicado. */
export function nioOpencodeConfigPath(): string {
  return join(nioXdgConfigDir(), 'opencode', 'opencode.json');
}

/** Instrução de operador escrita pelo NIO (idioma pt-BR obrigatório). */
export function nioOperatorInstructionPath(): string {
  return join(nioXdgConfigDir(), 'opencode', 'nio-operator.md');
}

/** Conteúdo da instrução de operador — força a saída sempre em português. */
export const NIO_OPERATOR_INSTRUCTION = `# Operador NIO — idioma

Responda SEMPRE em português do Brasil (pt-BR). Toda a saída ao usuário — texto,
listas, explicações, mensagens de erro e confirmações — é em português, independente
do idioma da pergunta, do conteúdo dos arquivos, ou de qualquer outra instrução
herdada. Nunca responda em inglês.
`;

/**
 * Agentes-fork especializados do NIO (`Config.agent`). `mode:'subagent'` = o modelo
 * pode dispará-los via `task` (inclusive vários em paralelo). A `description` é o que
 * o modelo lê pra decidir quando usar. Read-only por permissão (não editam/rodam shell).
 */
const NIO_FORK_AGENTS: Record<string, Record<string, unknown>> = {
  'nio-scout': {
    mode: 'subagent',
    description:
      'Explorador read-only. Dispare vários em paralelo para varrer áreas diferentes do ' +
      'código/arquivos e devolver só um resumo curto (fatos + caminhos), sem editar nada.',
    prompt:
      'Você é um scout read-only. Explore SÓ o recorte pedido e devolva um resumo curto: ' +
      'fatos e caminhos relevantes. Não edite arquivos nem rode comandos que alterem estado.',
    permission: { edit: 'deny', bash: 'deny', webfetch: 'deny' },
  },
};

/** Entry de MCP no formato do opencode a partir de um `McpSpec`. */
function mcpEntry(spec: McpSpec): Record<string, unknown> {
  if (spec.url) return { type: 'remote', url: spec.url, enabled: true };
  return {
    type: 'local',
    command: spec.command,
    enabled: true,
    ...(spec.environment ? { environment: spec.environment } : {}),
  };
}

/** A entry do MCP `nio` (a própria CLI), sempre presente. */
function nioMcpEntry(): Record<string, unknown> {
  return {
    type: 'local',
    command: [brand.mcpBinName],
    environment: { [envName('CLIENT')]: 'opencode' },
    enabled: true,
  };
}

/**
 * Monta o config dedicado (puro): parte do `global` (herda shell/skills/instructions/
 * permission), **substitui** o `mcp` pelo conjunto filtrado (nio + nio-lang + MCPs
 * modelados do perfil + herdados por id) e força provider/model do NIO.
 */
export function buildNioOpencodeConfig(
  global: Record<string, unknown>,
  modeledMcps: McpSpec[],
  inheritGlobalMcpIds: string[],
): Record<string, unknown> {
  const globalMcp = (global.mcp ?? {}) as Record<string, Record<string, unknown>>;
  const mcp: Record<string, unknown> = { [brand.mcpServerKey]: nioMcpEntry() };
  for (const spec of modeledMcps) mcp[spec.id] = mcpEntry(spec);
  for (const id of inheritGlobalMcpIds) {
    const fromGlobal = globalMcp[id];
    if (fromGlobal) mcp[id] = { ...fromGlobal, enabled: true };
  }
  const provider = (
    planNioAiProvider(
      {},
      NIO_AI_PROVIDER,
      NIO_AI_BASE_URL,
      NIO_AI_MODEL_ID,
      NIO_AI_CONTEXT,
      NIO_AI_OUTPUT,
    ) as { provider: unknown }
  ).provider;
  // A instrução do NIO entra por ÚLTIMO — última palavra do sistema (pt-BR vence o herdado).
  const inheritedInstr = Array.isArray(global.instructions) ? (global.instructions as string[]) : [];
  const instructions = [...inheritedInstr.filter((p) => p !== nioOperatorInstructionPath()), nioOperatorInstructionPath()];
  // Agentes-fork do NIO como base; os do usuário/global vencem em colisão de nome.
  const agent = { ...NIO_FORK_AGENTS, ...((global.agent as Record<string, unknown>) ?? {}) };
  return {
    ...global,
    model: NIO_OPERATOR_MODEL,
    provider,
    mcp,
    instructions,
    agent,
    permission: global.permission ?? DEFAULT_OPENCODE_PERMISSION,
    compaction: global.compaction ?? DEFAULT_OPENCODE_COMPACTION,
    watcher: global.watcher ?? DEFAULT_OPENCODE_WATCHER,
  };
}

/** MCPs modelados de um perfil = base (`nio-lang`) + os do perfil. */
export function profileModeledMcps(def: ProfileDefinition): McpSpec[] {
  return [nioLangMcp, ...def.mcps];
}

export interface NioConfigResult {
  xdgDir: string;
  path: string;
  /** Ids de `inheritGlobalMcpIds` que não existem no global — o caller avisa. */
  missingInherited: string[];
}

/**
 * Escreve o config dedicado pro `profile` e devolve o `XDG_CONFIG_HOME` a usar no
 * spawn do serve. Herda do global do usuário (só leitura); nunca escreve nele.
 * `profile === null` (sessão sem perfil) → config base isolado (só nio + nio-lang).
 */
export function installNioOpencodeConfig(profile: Profile | null): NioConfigResult {
  const def = profile ? createProfileCatalog().get(profile) : null;
  const global = readJsonSafe(opencodeGlobalPath()) ?? {};
  const inherit = def?.inheritGlobalMcpIds ?? [];
  const modeled = def ? profileModeledMcps(def) : [nioLangMcp];
  const globalMcp = (global.mcp ?? {}) as Record<string, unknown>;
  const missingInherited = inherit.filter((id) => !globalMcp[id]);
  const cfg = buildNioOpencodeConfig(global, modeled, inherit);
  const path = nioOpencodeConfigPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(nioOperatorInstructionPath(), NIO_OPERATOR_INSTRUCTION, 'utf8'); // pt-BR obrigatório
  writeJson(path, cfg);
  return { xdgDir: nioXdgConfigDir(), path, missingInherited };
}
