/**
 * Tool `nio_lang_recipe` do server `nio-lang` — devolve a recipe de ambiente de
 * uma linguagem (do `LanguageCatalog`). Handler puro (catálogo injetável) pra
 * ser testável sem subir o server.
 */
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { LANGUAGE_IDS, isLanguageId, type LanguageCatalog } from '../core/lang.js';
import { jsonResult, errorResult } from '../lib/tool-result.js';

export const definition: Tool = {
  name: 'nio_lang_recipe',
  description:
    'Recipe de ambiente de uma linguagem: runtime, package manager, frameworks, ' +
    `ORMs, libs base, tipagens e o SDK de MCP. Linguagens: ${LANGUAGE_IDS.join(', ')}.`,
  inputSchema: {
    type: 'object',
    properties: {
      language: {
        type: 'string',
        enum: [...LANGUAGE_IDS],
        description: 'Linguagem a consultar.',
      },
    },
    required: ['language'],
  },
};

/** Handler puro — recebe o `LanguageCatalog` (injetável pra teste). */
export function handleLangRecipe(args: unknown, catalog: LanguageCatalog): CallToolResult {
  const a = (args ?? {}) as { language?: unknown };
  if (!isLanguageId(a.language)) {
    return errorResult(`language inválida. Use uma de: ${LANGUAGE_IDS.join(', ')}.`);
  }
  try {
    return jsonResult(catalog.recipe(a.language));
  } catch (err) {
    return errorResult((err as Error).message);
  }
}
