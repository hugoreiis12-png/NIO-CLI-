/**
 * Contrato do gerador de DAX. O foco é o que é puro e frágil: a extração do DAX da
 * resposta do modelo, a ordem das seções do prompt e a conversão das exceções do
 * `qwenComplete` no contrato nunca-lança.
 */
import { test, expect } from 'bun:test';
import { buildDaxPrompt, extractDax, createDaxGenerator } from './dax-generator.js';
import type { GenerateRequest } from './dax-rag.js';

const base: GenerateRequest = {
  question: 'qual o total de vendas',
  workspaceId: 'ws',
  datasetId: 'ds',
};

test('extractDax: tira cerca ```dax, cerca simples e rótulo', () => {
  expect(extractDax('```dax\nEVALUATE ROW("a",1)\n```')).toBe('EVALUATE ROW("a",1)');
  expect(extractDax('```\nEVALUATE ROW("a",1)\n```')).toBe('EVALUATE ROW("a",1)');
  expect(extractDax('DAX: EVALUATE ROW("a",1)')).toBe('EVALUATE ROW("a",1)');
  expect(extractDax('  EVALUATE ROW("a",1)  ')).toBe('EVALUATE ROW("a",1)'); // cru
});

test('extractDax: preserva consulta multi-linha dentro da cerca', () => {
  const dax = 'DEFINE\n  MEASURE T[M] = 1\nEVALUATE\n  ROW("a", [M])';
  expect(extractDax('```dax\n' + dax + '\n```')).toBe(dax);
});

test('buildDaxPrompt: sem contexto, manda só a pergunta', () => {
  const p = buildDaxPrompt(base);
  expect(p).toContain('Pergunta: qual o total de vendas');
  expect(p).not.toContain('Documentação relevante');
  expect(p).not.toContain('JÁ FOI VALIDADA');
});

test('buildDaxPrompt: Nível 1 manda o template como BASE pra adaptar', () => {
  const p = buildDaxPrompt({
    ...base,
    template: { dax: "EVALUATE 'Vendas'", questionNorm: 'total de vendas 2026' },
  });
  expect(p).toContain('JÁ FOI VALIDADA');
  expect(p).toContain("EVALUATE 'Vendas'");
  expect(p).toContain('mudando SOMENTE o que ela exige'); // instrução de adaptação
});

test('buildDaxPrompt: Nível 2 injeta a documentação', () => {
  const p = buildDaxPrompt({ ...base, docs: ['CALCULATE altera o contexto de filtro.'] });
  expect(p).toContain('Documentação relevante');
  expect(p).toContain('CALCULATE altera o contexto de filtro.');
});

test('buildDaxPrompt: retry carrega o erro E o DAX que falhou', () => {
  const p = buildDaxPrompt({
    ...base,
    previousError: "Cannot find table 'Metas'.",
    previousDax: "EVALUATE 'Metas'",
  });
  expect(p).toContain('tentativa anterior FALHOU');
  expect(p).toContain("Cannot find table 'Metas'.");
  expect(p).toContain("EVALUATE 'Metas'"); // sem isso o modelo corrige às cegas
});

test('buildDaxPrompt: retry sem o DAX anterior ainda funciona (campo opcional)', () => {
  const p = buildDaxPrompt({ ...base, previousError: 'erro X' });
  expect(p).toContain('tentativa anterior FALHOU');
  expect(p).not.toContain('DAX que falhou');
});

test('system prompt carrega os limites REAIS do executeQueries', async () => {
  let system = '';
  const gen = createDaxGenerator(async (_p, opts) => {
    system = opts?.system ?? '';
    return 'EVALUATE ROW("a",1)';
  });
  await gen(base);
  // regressão: sem estas regras o modelo volta a gerar os erros que vimos em produção
  expect(system).toContain('$System'); // DMV não funciona aqui
  expect(system).toContain('EVALUATE ROW("Linhas", COUNTROWS'); // escalar precisa embrulhar
  // medido no tenant: INFO.VIEW.TABLES() funciona, INFO.TABLES() devolve 400
  expect(system).toContain('INFO.VIEW.TABLES()');
  expect(system).toContain('retorna 400 neste tenant');
});

test('system prompt carrega os padrões validados (contagem, texto, período, aspas)', async () => {
  let system = '';
  const gen = createDaxGenerator(async (_p, opts) => {
    system = opts?.system ?? '';
    return 'EVALUATE ROW("a",1)';
  });
  await gen(base);

  // o caso real: SUM(frequency) deu 25M onde COUNTROWS dava 1.707
  expect(system).toContain('COUNTROWS(FILTER(...))');
  expect(system).toContain('1.707');
  expect(system).toContain('CONTAINSSTRING');
  expect(system).toContain('YEAR(');
  // o modelo tem tabelas chamadas `tb_mp.`, `tb_mp,` e `DAX` — aspas não são opcionais
  expect(system).toContain('aspas simples');
  expect(system).toContain('Não invente'); // nomes vêm do schema no contexto
});

test('createDaxGenerator: sucesso devolve o DAX limpo', async () => {
  const gen = createDaxGenerator(async () => '```dax\nEVALUATE ROW("a",1)\n```');
  const out = await gen(base);
  expect(out.status).toBe('ok');
  expect(out.data).toBe('EVALUATE ROW("a",1)');
});

test('createDaxGenerator: resposta vazia vira failed (não devolve string vazia)', async () => {
  const gen = createDaxGenerator(async () => '   ');
  const out = await gen(base);
  expect(out.status).toBe('failed');
  expect(out.error).toContain('vazia');
});

test('createDaxGenerator: exceção do qwen NÃO escapa — vira RagResult', async () => {
  const gen = createDaxGenerator(async () => {
    throw new Error('input acima do teto');
  });
  const out = await gen(base);
  expect(out.status).toBe('failed');
  expect(out.error).toContain('acima do teto');
});

test('createDaxGenerator: erro de rede vira unavailable (dá pra tentar de novo)', async () => {
  const gen = createDaxGenerator(async () => {
    throw new Error('connect ECONNREFUSED 192.168.0.140:8001');
  });
  const out = await gen(base);
  expect(out.status).toBe('unavailable');
});
