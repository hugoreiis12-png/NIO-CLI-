// Tool `nio_pbi_local` — onde o Power BI Desktop está servindo XMLA agora.
//
// Existe porque o agente chutava `localhost:55100` (número de tutorial) e concluía que o
// modo local estava fora do ar. Medido: o Desktop servia em `localhost:31272`. A porta é
// sorteada a cada abertura — não há valor pra lembrar, só pra descobrir.
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext } from './index.js';
import { jsonResult, errorResult } from '../lib/tool-result.js';
import { brand } from '../brand.js';
import { discoverLocalXmla } from '../adapters/powerbi/local-endpoint.js';

export const definition: Tool = {
  name: `${brand.cliToolPrefix}pbi_local`,
  description:
    'Descobre o endpoint XMLA do Power BI Desktop aberto nesta máquina (Analysis Services ' +
    'local). A porta é EFÊMERA — muda a cada abertura do Desktop, então nunca a suponha ' +
    'nem reutilize de uma sessão anterior: chame esta tool. Use antes de qualquer conexão ' +
    'local. Se o Desktop estiver fechado ou sem modelo aberto, a resposta diz isso.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
};

export async function handler(_args: unknown, _ctx: ToolContext): Promise<CallToolResult> {
  const res = await discoverLocalXmla();
  if (res.status === 'ok') {
    return jsonResult({
      endpoint: res.endpoint,
      porta: res.port,
      aviso: 'porta efêmera — vale só enquanto este Desktop estiver aberto.',
    });
  }
  return errorResult(res.error ?? res.status);
}
