#!/usr/bin/env node
/**
 * `nio-lang` — MCP server nativo da CLI que centraliza conhecimento/config das
 * linguagens (Python, TypeScript, Node.js, C#, n8n). Fatia 1: camada de
 * conhecimento (tool `nio_lang_reference` servindo o cache vendorado dos 5
 * repos). Scaffolding e mais tools vêm nas próximas fatias.
 *
 * Sem autenticação de usuário: serve conhecimento de linguagem (público). Única
 * exceção: as tools de n8n (`lang-n8n.ts`) usam `N8N_API_KEY` do ambiente do próprio
 * usuário, e a de escrita é gateada por `askTools`. O `nio` (mcp-server.ts) exige JWT. Ver `docs/arch/ARQUITETURA-NIO-LANG.md`.
 */
import './lib/load-env.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { VERSION } from './version.js';
import { createKnowledgeStore } from './adapters/lang/knowledge-store.js';
import { createLanguageCatalog } from './adapters/lang/language-catalog.js';
import * as langReference from './tools/lang-reference.js';
import * as langRecipe from './tools/lang-recipe.js';
import * as langN8n from './tools/lang-n8n.js';

const BIN = 'nio-lang';

async function main(): Promise<void> {
  const store = createKnowledgeStore();
  const catalog = createLanguageCatalog();
  const server = new Server({ name: BIN, version: VERSION }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      langReference.definition,
      langRecipe.definition,
      langN8n.readDefinition,
      langN8n.writeDefinition,
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === langReference.definition.name) {
      return langReference.handleLangReference(request.params.arguments ?? {}, store);
    }
    if (request.params.name === langRecipe.definition.name) {
      return langRecipe.handleLangRecipe(request.params.arguments ?? {}, catalog);
    }
    if (request.params.name === langN8n.readDefinition.name) {
      return langN8n.handleLangN8n(request.params.arguments ?? {});
    }
    if (request.params.name === langN8n.writeDefinition.name) {
      return langN8n.handleLangN8nWrite(request.params.arguments ?? {});
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
