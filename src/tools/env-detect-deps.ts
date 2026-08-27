// Tool `nio_env_detect_deps` — um ciclo do DependencyWatcher sobre uma sessão.
import { z } from 'zod';
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext } from './index.js';
import { jsonResult, errorResult } from '../lib/tool-result.js';
import { SessionManager } from '../app/session-manager.js';
import { DependencyWatcher } from '../app/dependency-watcher.js';
import { createDependencyEventRepository } from '../adapters/pg/dependency-event-repository.js';
import { sessionErrorResult } from './session-shared.js';
import { brand } from '../brand.js';

const ArgsSchema = z
  .object({
    session: z.string().min(1).optional(),
    install: z.boolean().optional(),
  })
  .strict();

export const definition: Tool = {
  name: `${brand.cliToolPrefix}env_detect_deps`,
  description:
    'Roda UM ciclo do watcher de dependências sobre a pasta da sessão: escaneia os manifests ' +
    '(package.json, requirements.txt, Cargo.toml), detecta o que está declarado mas não ' +
    'instalado e registra um evento por dependência nova (idempotente). Com `install: true` ' +
    'roda o instalador do ecossistema (`npm install` / `pip install -r` / `cargo fetch`) — ' +
    'default é só detectar. Sem `session` usa a sessão ativa.',
  inputSchema: {
    type: 'object',
    properties: {
      session: { type: 'string', description: 'Id da sessão (prefixo do UUID basta). Omita para a ativa.' },
      install: { type: 'boolean', description: 'Instalar o que faltar (ação destrutiva). Default: false.' },
    },
    required: [],
    additionalProperties: false,
  },
};

/** Fábrica do watcher — injetável pra teste (default: repo Postgres real). */
export type MakeWatcher = (autoInstall: boolean) => DependencyWatcher;

const defaultMakeWatcher: MakeWatcher = (autoInstall) =>
  new DependencyWatcher({ repo: createDependencyEventRepository(), autoInstall });

/** Núcleo testável. */
export async function runEnvDetectDeps(
  manager: SessionManager,
  makeWatcher: MakeWatcher,
  userId: number,
  opts: { session?: string; install?: boolean },
): Promise<CallToolResult> {
  try {
    const session = await manager.resolveOrActive(userId, opts.session);
    const result = await makeWatcher(opts.install ?? false).tick(session);
    return jsonResult({
      session_id: session.id,
      scanned: result.scanned,
      missing: result.missing.map((d) => ({ name: d.name, type: d.type, file: d.filePath })),
      recorded: result.recorded.map((e) => ({ name: e.dependencyName, type: e.dependencyType, file: e.filePath })),
      installed: result.installed,
    });
  } catch (err) {
    return sessionErrorResult(err, 'detectar dependências');
  }
}

export async function handler(args: unknown, ctx: ToolContext): Promise<CallToolResult> {
  const parsed = ArgsSchema.safeParse(args);
  if (!parsed.success) return errorResult(`Argumento inválido: ${parsed.error.message}`);
  return runEnvDetectDeps(new SessionManager(), defaultMakeWatcher, ctx.user.id, parsed.data);
}
