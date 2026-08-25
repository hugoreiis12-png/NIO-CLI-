/**
 * Tool `nio_lang_reference` do server `nio-lang` — devolve a referência de
 * conhecimento de uma linguagem (do `KnowledgeStore`). Handler puro (store
 * injetável) pra ser testável sem subir o server.
 */
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { LANGUAGE_IDS, isLanguageId, type KnowledgeStore } from '../core/lang.js';

export const definition: Tool = {
  name: 'nio_lang_reference',
  description:
    'Referência de conhecimento (sintaxe, tipagens, SDK) de uma linguagem ' +
    `centralizada pelo nio-lang. Linguagens: ${LANGUAGE_IDS.join(', ')}.`,
  inputSchema: {
    type: 'object',
    properties: {
      language: {
        type: 'string',
        enum: [...LANGUAGE_IDS],
        description: 'Linguagem a consultar.',
      },
      topic: { type: 'string', description: 'Tópico/assunto (opcional; refina a busca).' },
    },
    required: ['language'],
  },
};

/** Handler puro — recebe o `KnowledgeStore` (injetável pra teste). */
export function handleLangReference(args: unknown, store: KnowledgeStore): CallToolResult {
  const a = (args ?? {}) as { language?: unknown; topic?: unknown };
  if (!isLanguageId(a.language)) {
    return {
      content: [{ type: 'text', text: `language inválida. Use uma de: ${LANGUAGE_IDS.join(', ')}.` }],
      isError: true,
    };
  }
  const topic = typeof a.topic === 'string' ? a.topic : undefined;
  const ref = store.reference(a.language, topic);
  return {
    content: [{ type: 'text', text: ref.content }],
    isError: !ref.found,
  };
}
