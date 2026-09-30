import { test, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  classifyOutcome,
  recordQuery,
  readMetrics,
  summarize,
  type QueryMetric,
} from './query-metrics.js';

const dirs: string[] = [];
const novoDir = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'nio-metrics-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  delete process.env.NIO_METRICS;
});

const agora = (o: Partial<QueryMetric> = {}): QueryMetric => ({
  ts: new Date().toISOString(),
  op: 'executeDax',
  outcome: 'ok',
  ms: 100,
  ...o,
});

// As mensagens abaixo vieram de `agent_lesson` em produção — não da documentação.
test('classifica coluna inexistente nas DUAS redações do Power BI', () => {
  expect(
    classifyOutcome(
      'failed',
      "Query (1, 8) column 'Faturamento' cannot be found or may not be used in this expression.",
    ),
  ).toBe('column_not_found');
  expect(
    classifyOutcome(
      'failed',
      "The value for 'faturamento bruto' cannot be determined. Either the column doesn't exist",
    ),
  ).toBe('column_not_found');
});

// Capturadas do Power BI em 2026-09-28, não do histórico sanitizado: o nome vem
// envolto em <oii> e há `in table '…'` entre as aspas, o que quebrava o padrão
// anterior e fazia as duas caírem em other_dax_error.
test('classifica as mensagens REAIS, com tags <oii> e texto no meio', () => {
  expect(
    classifyOutcome(
      'failed',
      "Power BI respondeu 400: DatasetExecuteQueriesError: Query (1, 41) Column '<oii>nao_existe</oii>' in table '<oii>CALENDARIO</oii>' cannot be found or may not be used in this expression.",
    ),
  ).toBe('column_not_found');
  expect(
    classifyOutcome(
      'failed',
      "Power BI respondeu 400: DatasetExecuteQueriesError: Query (1, 10) Failed to resolve name 'TabelaQueNaoExiste'. It is not a valid table, variable, or function name.",
    ),
  ).toBe('table_not_found');
});

test('classifica tabela, tipo, sintaxe e função', () => {
  expect(classifyOutcome('failed', "Cannot find table 'T'.")).toBe('table_not_found');
  expect(
    classifyOutcome(
      'failed',
      'DAX comparison operations do not support comparing values of type Text with Integer',
    ),
  ).toBe('type_mismatch');
  expect(classifyOutcome('failed', "The syntax for 'or' is incorrect.")).toBe('syntax_error');
  expect(
    classifyOutcome('failed', "The search text provided to function 'FIND' could not be found"),
  ).toBe('function_error');
});

test('status que não é de DAX não vira categoria de DAX', () => {
  expect(classifyOutcome('ok')).toBe('ok');
  expect(classifyOutcome('unauthorized', 'PowerBINotAuthorizedException')).toBe('unauthorized');
  expect(classifyOutcome('throttled', '429')).toBe('throttled');
  expect(classifyOutcome('unavailable', 'timeout')).toBe('unavailable');
});

// Um erro novo do Power BI não pode virar 'ok' silenciosamente.
test('erro desconhecido cai em other_dax_error, não em ok', () => {
  expect(classifyOutcome('failed', 'mensagem que ainda não mapeamos')).toBe('other_dax_error');
  expect(classifyOutcome('failed')).toBe('other_dax_error');
});

test('grava e lê de volta', () => {
  const d = novoDir();
  recordQuery(agora({ outcome: 'column_not_found', ms: 250, datasetId: 'ds1' }), d);
  const lidas = readMetrics(30, d);
  expect(lidas).toHaveLength(1);
  expect(lidas[0]!.outcome).toBe('column_not_found');
  expect(lidas[0]!.datasetId).toBe('ds1');
}, 30_000); // IO real em tmpdir sob contenção de NTFS — passa em ~100ms isolado,
// mas a suíte inteira compete pelo disco (§ 11.1 do backlog). O
// timeout é honestidade sobre o custo de IO, não um tapa-buraco.

test('NIO_METRICS=0 não grava nada', () => {
  const d = novoDir();
  process.env.NIO_METRICS = '0';
  recordQuery(agora(), d);
  expect(readMetrics(30, d)).toHaveLength(0);
});

test('linha corrompida é pulada, o resto é lido', () => {
  const d = novoDir();
  recordQuery(agora({ outcome: 'ok' }), d);
  const arquivo = join(d, `fabric-${new Date().toISOString().slice(0, 10)}.jsonl`);
  writeFileSync(
    arquivo,
    '{"ts":"quebrad\n' + JSON.stringify(agora({ outcome: 'table_not_found' })) + '\n',
    'utf8',
  );
  const lidas = readMetrics(30, d);
  expect(lidas).toHaveLength(1);
  expect(lidas[0]!.outcome).toBe('table_not_found');
}, 30_000); // idem: IO real em tmpdir, § 11.1.

test('registro fora da janela de dias é descartado', () => {
  const d = novoDir();
  const antigo = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
  recordQuery(agora({ ts: antigo }), d);
  expect(readMetrics(30, d)).toHaveLength(0);
  expect(readMetrics(60, d)).toHaveLength(1);
});

test('diretório inexistente devolve lista vazia, não erro', () => {
  expect(readMetrics(30, join(tmpdir(), 'nio-metrics-que-nao-existe-12345'))).toEqual([]);
});

test('summarize: taxa de erro e percentis só de executeDax', () => {
  const s = summarize([
    agora({ outcome: 'ok', ms: 100 }),
    agora({ outcome: 'ok', ms: 200 }),
    agora({ outcome: 'column_not_found', ms: 300 }),
    agora({ outcome: 'table_not_found', ms: 400 }),
    agora({ op: 'listWorkspaces', outcome: 'ok', ms: 9999 }), // fora da conta
  ]);
  expect(s.total).toBe(4);
  expect(s.porOutcome.ok).toBe(2);
  expect(s.porOutcome.column_not_found).toBe(1);
  expect(s.taxaErro).toBe(0.5);
  expect(s.msP95).toBeLessThanOrEqual(400);
});

test('summarize sem dados não divide por zero', () => {
  const s = summarize([]);
  expect(s.total).toBe(0);
  expect(s.taxaErro).toBe(0);
  expect(s.msP50).toBe(0);
});
