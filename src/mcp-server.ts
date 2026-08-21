#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { VERSION } from './version.js';
import { loadProjectConfig, type ProjectConfig } from './config.js';
import { createSession, type Session } from './session-factory.js';
import { tools, toolDefinitions, type ToolContext } from './tools/index.js';
import { errorResult } from './lib/tool-result.js';
import { notifyMcpServerIfUpdate } from './lib/version-check.js';
import { filterSkillsForSurface } from './lib/skills.js';
import {
  loadSkills,
  skillResourceDescriptors,
  readSkillResource,
  skillPromptDescriptors,
  buildSkillPrompt,
} from './lib/skill-serve.js';
import { provision } from './lib/provision.js';
import { provisionHooks } from './lib/hooks.js';
import { claudeTarget, type ProvisionTarget } from './lib/targets.js';
import { ensureSkillsCache } from './lib/skills-cache.js';
import { shouldRunAutoPull, pickProvisionTarget } from './lib/autopull.js';
import { brand, env } from './brand.js';

/** Carrega o config do projeto; erro de parse é degradado (log + null), nunca fatal. */
function loadConfigStep(): ProjectConfig | null {
  try {
    return loadProjectConfig();
  } catch (err) {
    console.error(`[${brand.mcpBinName}] ${brand.projectConfigFile} inválido: ${(err as Error).message}`);
    return null;
  }
}

// Skills vêm de um repo aberto → garante o cache local (~/.nio/skills) antes
// de servir/auto-pull. Baixa só se ausente; best-effort (offline → degrada).
async function initSkillsCache(): Promise<void> {
  try {
    const r = await ensureSkillsCache();
    if (r.status === 'fetched') {
      console.error(`[${brand.mcpBinName}] skills baixadas (${r.repo}@${r.ref})`);
    } else if (r.status === 'failed') {
      console.error(`[${brand.mcpBinName}] aviso: skills indisponíveis: ${r.error}`);
    }
  } catch (err) {
    console.error(`[${brand.mcpBinName}] aviso: cache de skills pulado: ${(err as Error).message}`);
  }
}

async function authenticateSession(): Promise<Session | null> {
  try {
    const session = await createSession();
    console.error(`[${brand.mcpBinName}] autenticado como ${session.user.email}`);
    return session;
  } catch (err) {
    console.error(`[${brand.mcpBinName}] aviso: ${(err as Error).message}`);
    return null;
  }
}

/** Surface deste worker (pra filtro de visibilidade `clients:`). Cowork seta
 * NIO_CLIENT=cowork; Claude Code costuma deixar vazio → sem filtro (mostra tudo). */
function resolveSurface(): string | null {
  return env('CLIENT') || null;
}

function registerToolHandlers(
  server: Server,
  session: Session | null,
  projectConfig: ProjectConfig | null,
): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDefinitions,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = tools[request.params.name];
    if (!tool) {
      return errorResult(`Tool desconhecida: ${request.params.name}`);
    }
    if (!session) {
      return errorResult(
        `Não autenticado. Rode \`${brand.name} login\` antes de iniciar o Claude Code.`,
      );
    }
    const ctx: ToolContext = {
      gateway: session.gateway,
      user: session.user,
      config: projectConfig,
    };
    try {
      return await tool.handler(request.params.arguments ?? {}, ctx);
    } catch (err) {
      return errorResult(`Erro inesperado em ${request.params.name}: ${(err as Error).message}`);
    }
  });
}

// Resources: o conhecimento (skills/commands/agents) do pacote @nio-cli/skills.
// Deixa o worker de IA ler os artefatos sob demanda, mesmo sem rodar `nio sync`.
function registerResourceHandlers(server: Server, surface: string | null): void {
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    try {
      const { docs } = loadSkills();
      return { resources: skillResourceDescriptors(filterSkillsForSurface(docs, surface)) };
    } catch (err) {
      console.error(`[${brand.mcpBinName}] aviso: skills indisponíveis: ${(err as Error).message}`);
      return { resources: [] };
    }
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { docs, rawByPath } = loadSkills();
    const r = readSkillResource(
      request.params.uri,
      filterSkillsForSurface(docs, surface),
      rawByPath,
    );
    return { contents: [{ uri: r.uri, mimeType: r.mimeType, text: r.text }] };
  });
}

// Prompts: commands/skills como prompts invocáveis. Funciona no Claude Code E no
// Cowork (que não lê `~/.claude`) — é o caminho de slash-command lá.
function registerPromptHandlers(
  server: Server,
  surface: string | null,
  session: Session | null,
): void {
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    try {
      const { docs } = loadSkills();
      return { prompts: skillPromptDescriptors(filterSkillsForSurface(docs, surface)) };
    } catch (err) {
      console.error(`[${brand.mcpBinName}] aviso: prompts indisponíveis: ${(err as Error).message}`);
      return { prompts: [] };
    }
  });

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const visible = filterSkillsForSurface(loadSkills().docs, surface);
    const { description, text } = buildSkillPrompt(
      request.params.name,
      request.params.arguments,
      visible,
    );
    // Telemetria de uso (Cowork): qual skill/command foi invocado (id estável + nome).
    session?.gateway.track({
      type: 'prompt',
      client: surface ?? 'unknown',
      id: visible.find((d) => d.id === request.params.name)?.uid ?? null,
      name: request.params.name,
    });
    return {
      description,
      messages: [{ role: 'user', content: { type: 'text', text } }],
    };
  });
}

// Hooks (só Claude Code): re-registra os gatilhos no settings.json.
function reinstallHooksIfClaude(target: ProvisionTarget, projectConfig: ProjectConfig | null): void {
  if (target !== claudeTarget) return;
  const h = provisionHooks({
    surface: claudeTarget.surface,
    selection: projectConfig?.selection,
  });
  if (h.installed.length > 0 || h.prunedScripts.length > 0) {
    console.error(
      `[${brand.mcpBinName}] auto-pull: ${h.installed.length} hooks, ` +
        `${h.prunedScripts.length} removidos em ${h.settingsPath}.`,
    );
  }
}

// Auto-pull: a cada start, refresca os arquivos nativos (idempotente via manifesto;
// desliga com NIO_AUTO_PULL=0). No Cowork as skills chegam por resources/prompts,
// não por arquivo nativo — então pulamos.
async function runAutoPull(projectConfig: ProjectConfig | null): Promise<void> {
  const client = env('CLIENT');
  const autoPull = env('AUTO_PULL');
  if (!shouldRunAutoPull(client, autoPull)) return;

  const target = pickProvisionTarget(client);
  try {
    const result = provision({ target, selection: projectConfig?.selection });
    const changed = result.files.filter((f) => f.action === 'create' || f.action === 'update');
    const pruned = result.files.filter((f) => f.action === 'prune');
    if (changed.length > 0 || pruned.length > 0) {
      console.error(
        `[${brand.mcpBinName}] auto-pull: ${changed.length} atualizados, ` +
          `${pruned.length} removidos em ${result.targetDir}. Reinicie o cliente pra carregar.`,
      );
    }
    reinstallHooksIfClaude(target, projectConfig);
  } catch (err) {
    console.error(`[${brand.mcpBinName}] auto-pull pulou: ${(err as Error).message}`);
  }
}

async function main() {
  const projectConfig = loadConfigStep();
  await initSkillsCache();
  const session = await authenticateSession();

  const server = new Server(
    { name: brand.mcpBinName, version: VERSION },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );

  const surface = resolveSurface();

  registerToolHandlers(server, session, projectConfig);
  registerResourceHandlers(server, surface);
  registerPromptHandlers(server, surface, session);

  notifyMcpServerIfUpdate();

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[${brand.mcpBinName}] servidor iniciado (stdio)`);

  await runAutoPull(projectConfig);
}

main().catch((err) => {
  console.error(`[${brand.mcpBinName}] erro fatal: ${(err as Error).message}`);
  process.exit(1);
});
