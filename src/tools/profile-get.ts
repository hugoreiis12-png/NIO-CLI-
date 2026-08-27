// Tool `nio_profile_get` — consulta o catálogo de perfis de ambiente (read-only).
import { z } from 'zod';
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext } from './index.js';
import type { ProfileDefinition } from '../core/environment.js';
import { jsonResult, errorResult } from '../lib/tool-result.js';
import { createProfileCatalog } from '../profiles/index.js';
import { brand } from '../brand.js';

const ArgsSchema = z.object({ profile: z.string().min(1).optional() }).strict();

export const definition: Tool = {
  name: `${brand.cliToolPrefix}profile_get`,
  description:
    'Consulta o catálogo de perfis de ambiente (hardcoded na CLI). Sem `profile` → ' +
    'lista os 6 perfis com um resumo (linguagens, frameworks, toolchains e MCPs). Com ' +
    '`profile` → a definição completa daquele perfil, incluindo os comandos dos MCPs e o ' +
    'plano de detecção/instalação de cada toolchain. Read-only: não cria sessão nem materializa nada.',
  inputSchema: {
    type: 'object',
    properties: {
      profile: {
        type: 'string',
        enum: ['fullstack', 'analyst', 'scientist', 'dba', 'qa', 'bi'],
        description: 'Perfil a detalhar. Omita para listar todos.',
      },
    },
    required: [],
    additionalProperties: false,
  },
};

/** Resumo enxuto de um perfil (ids, sem os comandos/planos). */
function summarize(def: ProfileDefinition): Record<string, unknown> {
  return {
    profile: def.profile,
    languages: def.languages,
    frameworks: def.frameworks,
    toolchains: def.toolchains.map((t) => t.id),
    mcps: def.mcps.map((m) => m.id),
    envVars: def.envVars ?? {},
    aliases: def.aliases ?? {},
  };
}

export async function handler(args: unknown, _ctx: ToolContext): Promise<CallToolResult> {
  const parsed = ArgsSchema.safeParse(args);
  if (!parsed.success) {
    return errorResult(`Argumento inválido: ${parsed.error.message}`);
  }

  const catalog = createProfileCatalog();

  if (!parsed.data.profile) {
    return jsonResult({ profiles: catalog.list().map(summarize) });
  }

  try {
    const def = catalog.get(parsed.data.profile as ProfileDefinition['profile']);
    return jsonResult({
      ...summarize(def),
      mcpSpecs: def.mcps,
      toolchainSpecs: def.toolchains,
    });
  } catch (err) {
    return errorResult((err as Error).message);
  }
}
