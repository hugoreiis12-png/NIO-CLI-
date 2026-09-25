// Tool `nio_fabric_measure` — devolve a DEFINIÇÃO (fórmula DAX) das medidas do modelo.
//
// Existe porque o acervo já guardava as fórmulas (via scanner admin) e nenhuma tool as
// entregava ao agente: o grounding era consumido só pelo gerador de DAX, internamente.
// O modelo reclamava, com razão, que não havia endpoint de metadados — e caía em
// engenharia reversa por tentativa e erro, que é caro e adivinha.
import { z } from 'zod';
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext } from './index.js';
import { jsonResult, errorResult } from '../lib/tool-result.js';
import { brand } from '../brand.js';
import { parseMeasureChunks, type MeasureInfo } from '../app/measure-lookup.js';
import { findMeasureChunks } from '../adapters/pg/doc-index-repository.js';
import { schemaRepo } from '../app/schema-chunker.js';
import { orEnvDefault } from './fabric-shared.js';

const LIMITE_PADRAO = 10;

const ArgsSchema = z
  .object({
    name: z.string().min(1),
    dataset_id: z.string().min(1).optional(),
    limit: z.number().int().positive().max(50).optional(),
  })
  .strict();

export const definition: Tool = {
  name: `${brand.cliToolPrefix}fabric_measure`,
  description:
    'Devolve a DEFINIÇÃO das medidas do modelo semântico: nome, tabela e a fórmula DAX ' +
    'exata. Use quando precisar ENTENDER ou CONFERIR o que uma medida calcula — não ' +
    'tente deduzir por tentativa e erro com consultas. Busca por nome, inteiro ou parte ' +
    '(ex.: "FAT_BRUTO" traz a família toda). Requer o schema indexado ' +
    '(`nio_fabric_schema_sync`) e depende de o locatário liberar as expressões DAX; sem ' +
    'isso a medida vem sem fórmula e a resposta diz isso.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Nome da medida, inteiro ou parte dele.' },
      dataset_id: { type: 'string', description: 'GUID do dataset. Default: NIO_FABRIC_DATASET.' },
      limit: { type: 'number', description: `Máximo de medidas a devolver (padrão ${LIMITE_PADRAO}).` },
    },
    required: ['name'],
    additionalProperties: false,
  },
};

/** Busca de medidas no acervo — seam pra teste. */
export type MeasureFinder = (repo: string, termo: string, limit: number) => Promise<string[]>;

/** Núcleo testável. */
export async function runFabricMeasure(
  find: MeasureFinder,
  datasetId: string,
  termo: string,
  limit = LIMITE_PADRAO,
): Promise<CallToolResult> {
  const chunks = await find(schemaRepo(datasetId), termo, limit);
  const medidas = parseMeasureChunks(chunks);

  if (medidas.length === 0) {
    return errorResult(
      `Nenhuma medida com "${termo}" no acervo deste modelo. ` +
        'Se o schema nunca foi indexado, rode `nio_fabric_schema_sync` primeiro.',
    );
  }

  const semFormula = medidas.filter((m) => !m.formula).length;
  return jsonResult({
    encontradas: medidas.length,
    medidas: medidas.map(resumir),
    // Dizer por que a fórmula falta é melhor que devolver `null` e deixar o agente supor.
    ...(semFormula > 0
      ? {
          aviso:
            `${semFormula} medida(s) sem fórmula: o locatário do Power BI precisa liberar ` +
            '"Metadados detalhados" e "Expressões DAX e mashup" na API de administrador.',
        }
      : {}),
  });
}

function resumir(m: MeasureInfo): Record<string, unknown> {
  return {
    nome: m.nome,
    ...(m.tabela ? { tabela: m.tabela } : {}),
    ...(m.descricao ? { descricao: m.descricao } : {}),
    ...(m.formula ? { formula: m.formula } : { formula: null }),
  };
}

export async function handler(args: unknown, _ctx: ToolContext): Promise<CallToolResult> {
  const parsed = ArgsSchema.safeParse(args);
  if (!parsed.success) return errorResult(`Argumento inválido: ${parsed.error.message}`);

  const datasetId = orEnvDefault(parsed.data.dataset_id, 'NIO_FABRIC_DATASET');
  if (!datasetId) return errorResult('dataset_id ausente e NIO_FABRIC_DATASET não definido.');

  const find: MeasureFinder = async (repo, termo, limit) => {
    const res = await findMeasureChunks(repo, termo, limit);
    return res.status === 'ok' ? (res.data ?? []) : [];
  };
  return runFabricMeasure(find, datasetId, parsed.data.name, parsed.data.limit);
}
