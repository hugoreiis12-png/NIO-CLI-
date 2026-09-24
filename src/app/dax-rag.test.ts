/**
 * Contrato do orquestrador de 3 níveis. O teste mais importante deste arquivo é o
 * **anti-falso-positivo**: o benchmark mediu que perguntas ERRADAS (métrica/ano/dimensão
 * diferentes) pontuam 0,955–0,965 — acima de paráfrases legítimas. Como o Fabric valida
 * sintaxe e não intenção, replicar um template achado por similaridade devolveria números
 * plausíveis e errados. Aqui isso é barrado por teste, não por convenção.
 */
import { test, expect } from 'bun:test';
import { askDax, type DaxRagDeps, type GenerateRequest } from './dax-rag.js';
import type { DaxMemory, EmbeddingProvider, ScoredTemplate } from '../core/rag.js';
import type { FabricGateway, FabricRow } from '../core/fabric.js';

const TEMPLATE_VENDAS: ScoredTemplate = {
  id: 7,
  score: 0.9598, // score REAL medido entre "vendas" e "compras"
  requestName: 'total de vendas',
  questionNorm: 'qual o total de vendas por regiao em 2026',
  workspaceId: 'ws',
  datasetId: 'ds',
  dax: "EVALUATE SUMMARIZECOLUMNS('Regiao'[Nome], \"Total\", [Total Vendas])",
  outputSummary: { rowCount: 3, columns: ['Total'], sample: [] },
};

interface Spy {
  executed: string[];
  generated: GenerateRequest[];
  remembered: string[];
  hits: number[];
}

function makeDeps(opts: {
  exact?: ScoredTemplate | null;
  similar?: ScoredTemplate | null;
  generated?: string | null;
  failDax?: string; // esse DAX falha no Fabric (força o retry)
}): { deps: DaxRagDeps; spy: Spy } {
  const spy: Spy = { executed: [], generated: [], remembered: [], hits: [] };

  const memory: DaxMemory = {
    findByQuestion: async () => ({ status: 'ok', data: opts.exact ?? null }),
    findSimilar: async () => ({ status: 'ok', data: opts.similar ?? null }),
    remember: async (t) => {
      spy.remembered.push(t.dax);
      return { status: 'ok', data: 99 };
    },
    markHit: async (id) => {
      spy.hits.push(id);
      return { status: 'ok' };
    },
  };

  const embedder: EmbeddingProvider = {
    embedQuery: async () => ({ status: 'ok', data: [0.1, 0.2, 0.3] }),
    embedPassages: async () => ({ status: 'ok', data: [] }),
  };

  const fabric: FabricGateway = {
    listWorkspaces: async () => ({ status: 'ok', data: [] }),
    listDatasets: async () => ({ status: 'ok', data: [] }),
    executeDax: async (_ws, _ds, dax) => {
      spy.executed.push(dax);
      if (opts.failDax && dax === opts.failDax) {
        return { status: 'failed', error: "Cannot find table 'X'." };
      }
      return { status: 'ok', data: [{ Total: 10 }] as FabricRow[] };
    },
  };

  const generate = async (req: GenerateRequest) => {
    spy.generated.push(req);
    return opts.generated === null
      ? { status: 'failed' as const, error: 'modelo fora do ar' }
      : { status: 'ok' as const, data: opts.generated ?? 'EVALUATE ROW("Adaptado", 1)' };
  };

  return { deps: { memory, embedder, fabric, generate, templateMin: 0.88 }, spy };
}

const ask = { question: 'qual o total de compras por regiao em 2026', workspaceId: 'ws', datasetId: 'ds' };

// ─────────────────────────── CRITÉRIO DE ACEITE ───────────────────────────

test('ACEITE: template de VENDAS achado por similaridade NUNCA é executado para pergunta de COMPRAS', async () => {
  const { deps, spy } = makeDeps({ similar: TEMPLATE_VENDAS, generated: 'EVALUATE ROW("Compras", 5)' });
  const out = await askDax(deps, ask);

  expect(out.status).toBe('ok');
  // o DAX de vendas NÃO pode ter ido pro Fabric
  expect(spy.executed).not.toContain(TEMPLATE_VENDAS.dax);
  expect(out.data!.dax).not.toBe(TEMPLATE_VENDAS.dax);
  // veio pela adaptação, com o template como BASE (não como resposta)
  expect(out.data!.tier).toBe('adapted');
  expect(spy.generated[0]!.template?.dax).toBe(TEMPLATE_VENDAS.dax);
  expect(out.data!.dax).toBe('EVALUATE ROW("Compras", 5)');
});

test('ACEITE: se a adaptação FALHA, não cai de volta no DAX do template', async () => {
  // generated: null → o modelo falha. O perigo seria "usar o template mesmo assim".
  const { deps, spy } = makeDeps({ similar: TEMPLATE_VENDAS, generated: null });
  const out = await askDax(deps, ask);

  expect(spy.executed).not.toContain(TEMPLATE_VENDAS.dax); // nunca executou o errado
  expect(out.status).not.toBe('ok'); // falhou honestamente em vez de responder errado
});

// ─────────────────────────── Níveis ───────────────────────────

test('Nível 0: hit exato por hash → replay literal, SEM chamar o modelo', async () => {
  const { deps, spy } = makeDeps({ exact: { ...TEMPLATE_VENDAS, score: 1 } });
  const out = await askDax(deps, {
    question: 'qual o total de vendas por regiao em 2026',
    workspaceId: 'ws',
    datasetId: 'ds',
  });

  expect(out.data!.tier).toBe('replay');
  expect(out.data!.dax).toBe(TEMPLATE_VENDAS.dax); // aqui replicar É seguro (mesma pergunta)
  expect(spy.generated).toHaveLength(0); // não gastou o modelo
  expect(spy.hits).toEqual([7]); // contabilizou o reuso
});

test('Nível 1: adapta e grava o resultado (write-back)', async () => {
  const { deps, spy } = makeDeps({ similar: TEMPLATE_VENDAS, generated: 'EVALUATE ROW("C", 1)' });
  const out = await askDax(deps, ask);

  expect(out.data!.tier).toBe('adapted');
  expect(out.data!.score).toBe(0.9598);
  expect(spy.remembered).toEqual(['EVALUATE ROW("C", 1)']); // guarda o DAX adaptado, não o antigo
  expect(spy.generated[0]!.docs).toBeUndefined(); // nível 1 PULA a documentação
});

test('Nível 2: sem template → usa documentação e gera do zero', async () => {
  const { deps, spy } = makeDeps({ similar: null, generated: 'EVALUATE ROW("Novo", 1)' });
  deps.searchDocs = async () => ({ status: 'ok', data: ['CALCULATE modifies filter context.'] });
  const out = await askDax(deps, ask);

  expect(out.data!.tier).toBe('generated');
  expect(spy.generated[0]!.template).toBeUndefined();
  expect(spy.generated[0]!.docs).toEqual(['CALCULATE modifies filter context.']);
  expect(spy.remembered).toEqual(['EVALUATE ROW("Novo", 1)']);
});

test('retry: 400 legível volta pro modelo COM o erro e a 2ª tentativa vale', async () => {
  const { deps, spy } = makeDeps({ similar: null, generated: 'EVALUATE RUIM', failDax: 'EVALUATE RUIM' });
  deps.searchDocs = async () => ({ status: 'ok', data: ['Tabela: VENDAS | Colunas: VALOR'] });
  let call = 0;
  deps.generate = async (req) => {
    spy.generated.push(req);
    call += 1;
    return { status: 'ok', data: call === 1 ? 'EVALUATE RUIM' : 'EVALUATE BOM' };
  };
  const out = await askDax(deps, ask);

  expect(spy.generated[0]!.docs).toBeDefined(); // 1ª tentativa recebe o grounding
  expect(spy.generated[1]!.previousError).toContain("Cannot find table 'X'");
  // o grounding já falhou uma vez — reenviá-lo só duplica token
  expect(spy.generated[1]!.docs).toBeUndefined();
  // e o modelo precisa ver o DAX que ELE escreveu e quebrou
  expect(spy.generated[1]!.previousDax).toBe('EVALUATE RUIM');
  expect(out.data!.dax).toBe('EVALUATE BOM');
  expect(spy.executed).toEqual(['EVALUATE RUIM', 'EVALUATE BOM']);
});

test('Nível 0 com template velho (DAX já não roda) degrada pros níveis seguintes', async () => {
  const { deps, spy } = makeDeps({
    exact: { ...TEMPLATE_VENDAS, score: 1 },
    similar: null,
    generated: 'EVALUATE ROW("Regerado", 1)',
    failDax: TEMPLATE_VENDAS.dax, // o template envelheceu
  });
  const out = await askDax(deps, {
    question: 'qual o total de vendas por regiao em 2026',
    workspaceId: 'ws',
    datasetId: 'ds',
  });

  expect(out.status).toBe('ok');
  expect(out.data!.tier).toBe('generated'); // não travou no template quebrado
  expect(spy.hits).toHaveLength(0); // não conta hit de algo que falhou
});

test('embedder indisponível: propaga unconfigured em vez de lançar', async () => {
  const { deps } = makeDeps({ similar: null });
  deps.embedder = {
    embedQuery: async () => ({ status: 'unconfigured', error: 'rode nio fabric rag setup' }),
    embedPassages: async () => ({ status: 'unconfigured' }),
  };
  const out = await askDax(deps, ask);

  expect(out.status).toBe('unconfigured');
  expect(out.error).toContain('rag setup');
});
