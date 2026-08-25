#!/usr/bin/env node
/**
 * `nio-lang` — MCP server nativo da CLI que centraliza conhecimento/config das
 * linguagens (Python, TypeScript, Node.js, C#, n8n). Fatia 1: camada de
 * conhecimento (tool `nio_lang_reference` servindo o cache vendorado dos 5
 * repos). Scaffolding e mais tools vêm nas próximas fatias.
 *
 * Sem autenticação: serve conhecimento de linguagem (público, sem segredo) —
 * diferente do `nio` (mcp-server.ts), que exige JWT. Ver `docs/v2/ARQUITETURA-NIO-LANG.md`.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { VERSION } from './version.js';
import { createKnowledgeStore } from './adapters/lang/knowledge-store.js';
import { createLanguageCatalog } from './adapters/lang/language-catalog.js';
import * as langReference from './tools/lang-reference.js';
import * as langRecipe from './tools/lang-recipe.js';

const BIN = 'nio-lang';

async function main(): Promise<void> {
  const store = createKnowledgeStore();
  const catalog = createLanguageCatalog();
  const server = new Server({ name: BIN, version: VERSION }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [langReference.definition, langRecipe.definition],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === langReference.definition.name) {
      return langReference.handleLangReference(request.params.arguments ?? {}, store);
    }
    if (request.params.name === langRecipe.definition.name) {
      return langRecipe.handleLangRecipe(request.params.arguments ?? {}, catalog);
    }
    return {
      content: [{ type: 'text', text: `Tool desconhecida: ${request.params.name}` }],
      isError: true,
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[${BIN}] servidor iniciado (stdio)`);
}

main().catch((err) => {
  console.error(`[${BIN}] erro fatal: ${(err as Error).message}`);
  process.exit(1);
});
