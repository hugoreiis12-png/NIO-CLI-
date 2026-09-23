/**
 * Contrato da tool `nio_fabric_ask`: o que ela devolve ao agente. O DAX usado é sempre
 * exposto (o agente confere e pode reusar via `nio_fabric_query`), e a origem diz por
 * qual nível a resposta veio — é o que torna o custo legível.
 */
import { test, expect } from 'bun:test';
import { definition, runFabricAsk } from './fabric-ask.js';
import type { DaxRagDeps } from '../app/dax-rag.js';
import type { DaxMemory, EmbeddingProvider, ScoredTemplate } from '../core/rag.js';
import type { FabricGateway } from '../core/fabric.js';

const TEMPLATE: ScoredTemplate = {
  id: 1,
  score: 1,
  requestName: 'total',
  questionNorm: 'qual o total de vendas',
  workspaceId: 'ws',
  datasetId: 'ds',
  dax: 'EVALUATE ROW("Total", 10)',
  outputSummary: { rowCount: 1, columns: ['Total'], sample: [] },
};

function deps(opts: { exact?: ScoredTemplate | null; generated?: string } = {}): DaxRagDeps {
  const memory: DaxMemory = {
    findByQuestion: async () => ({ status: 'ok', data: opts.exact ?? null }),
    findSimilar: async () => ({ status: 'ok', data: null }),
    remember: async () => ({ status: 'ok', data: 1 }),
    markHit: async () => ({ status: 'ok' }),
  };
  const embedder: EmbeddingProvider = {
    embedQuery: async () => ({ status: 'ok', data: [0.1] }),
    embedPassages: async () => ({ status: 'ok', data: [] }),
  };
  const fabric: FabricGateway = {
    listWorkspaces: async () => ({ status: 'ok', data: [] }),
    listDatasets: async () => ({ status: 'ok', data: [] }),
    executeDax: async () => ({ status: 'ok', data: [{ Total: 10 }] }),
  };
  return {
    memory,
    embedder,
    fabric,
    generate: async () => ({ status: 'ok', data: opts.generated ?? 'EVALUATE ROW("Total", 10)' }),
  };
}

/** Payload JSON que a tool devolve. */
function payload(res: { content: { text?: string }[] }): Record<string, unknown> {
  return JSON.parse(res.content[0]!.text!) as Record<string, unknown>;
}

test('definition: nome prefixado e question obrigatória', () => {
  expect(definition.name).toBe('nio_fabric_ask');
  expect(definition.inputSchema.required).toEqual(['question']);
});

test('resposta expõe o DAX usado, a origem e as linhas', async () => {
  const res = await runFabricAsk(deps(), 'ws', 'ds', 'qual o total de vendas');
  const out = payload(res as { content: { text?: string }[] });
  expect(out.dax).toBe('EVALUATE ROW("Total", 10)');
  expect(out.row_count).toBe(1);
  expect(out.rows).toEqual([{ Total: 10 }]);
  expect(String(out.origem)).toContain('gerado');
});

test('hit exato é rotulado como cache (custo legível pro agente)', async () => {
  const res = await runFabricAsk(deps({ exact: TEMPLATE }), 'ws', 'ds', 'qual o total de vendas');
  const out = payload(res as { content: { text?: string }[] });
  expect(String(out.origem)).toContain('cache');
  expect(out.dax).toBe(TEMPLATE.dax);
});

test('embedder ausente → erro acionável, isError marcado', async () => {
  const d = deps();
  d.embedder = {
    embedQuery: async () => ({ status: 'unconfigured', error: 'rode `nio fabric rag setup`' }),
    embedPassages: async () => ({ status: 'unconfigured' }),
  };
  const res = (await runFabricAsk(d, 'ws', 'ds', 'qualquer')) as {
    isError?: boolean;
    content: { text?: string }[];
  };
  expect(res.isError).toBe(true);
  expect(res.content[0]!.text).toContain('não habilitada');
  expect(res.content[0]!.text).toContain('rag setup');
});

test('falha do Fabric vira erro de tool, não exceção', async () => {
  const d = deps();
  d.fabric.executeDax = async () => ({ status: 'failed', error: "Cannot find table 'X'." });
  const res = (await runFabricAsk(d, 'ws', 'ds', 'qualquer')) as {
    isError?: boolean;
    content: { text?: string }[];
  };
  expect(res.isError).toBe(true);
  expect(res.content[0]!.text).toContain("Cannot find table 'X'");
});
