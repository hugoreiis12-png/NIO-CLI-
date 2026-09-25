import { test, expect } from 'bun:test';
import {
  referencedTables,
  parseInventory,
  closestTables,
  checkDaxTables,
  explainUnknownTables,
} from './dax-guard.js';

const INVENTARIO = ['VISAO_COMERCIAL', 'CALENDARIO', 'tb_mp.', 'DAX'];

test('acha tabela entre aspas simples (a forma canônica em DAX)', () => {
  expect(referencedTables("EVALUATE 'VISAO_COMERCIAL'")).toEqual(['VISAO_COMERCIAL']);
});

test('acha tabela sem aspas antes de colchete', () => {
  expect(referencedTables('EVALUATE ROW("n", COUNTROWS(VENDAS[id]))')).toContain('VENDAS');
});

test('palavra-chave antes de colchete não vira tabela', () => {
  // `MEASURE Tabela[x] = ...` — `MEASURE` não é nome de tabela.
  const refs = referencedTables('DEFINE MEASURE X[y] = 1 EVALUATE {1}');
  expect(refs).not.toContain('DEFINE');
  expect(refs).not.toContain('MEASURE');
});

test('nome com caractere estranho sobrevive (o modelo tem `tb_mp.` e uma tabela `DAX`)', () => {
  expect(referencedTables("EVALUATE 'tb_mp.'")).toEqual(['tb_mp.']);
});

test('parseInventory lê o chunk do acervo', () => {
  const chunk = 'Tabelas do modelo semântico (2): VISAO_COMERCIAL, CALENDARIO';
  expect(parseInventory(chunk)).toEqual(['VISAO_COMERCIAL', 'CALENDARIO']);
});

test('ACEITE: tabela inventada é pega ANTES de gastar request', () => {
  // O caso real dos 400: o modelo escreve `Metas`, que não existe, e a API responde
  // `Cannot find table` sem dizer quais existem. Aqui a falha é local e informativa.
  const check = checkDaxTables("EVALUATE 'Metas'", INVENTARIO);
  expect(check.unknown).toEqual(['Metas']);
});

test('tabela real não é acusada — inclusive com caixa/acento diferente', () => {
  expect(checkDaxTables("EVALUATE 'visao_comercial'", INVENTARIO).unknown).toEqual([]);
  expect(checkDaxTables("EVALUATE 'VISÃO_COMERCIAL'", INVENTARIO).unknown).toEqual([]);
});

test('ACEITE: sem inventário NÃO bloqueia (ignorância não pode virar recusa)', () => {
  // Dataset ainda não indexado: executar e deixar o Fabric decidir é melhor que barrar.
  expect(checkDaxTables("EVALUATE 'QualquerCoisa'", []).unknown).toEqual([]);
});

test('sugere o nome parecido em vez de só recusar', () => {
  const check = checkDaxTables("EVALUATE 'VISAO_COMERCIAIS'", INVENTARIO);
  expect(check.suggestions['VISAO_COMERCIAIS']).toContain('VISAO_COMERCIAL');
});

test('closestTables não inventa parentesco onde não há', () => {
  expect(closestTables('ZZZZZZ', INVENTARIO)).toEqual([]);
});

test('a mensagem diz o erro, o que existe e o que fazer', () => {
  const check = checkDaxTables("EVALUATE 'Metas'", INVENTARIO);
  const msg = explainUnknownTables(check, INVENTARIO);
  expect(msg).toContain('Metas');
  expect(msg).toContain('VISAO_COMERCIAL'); // o agente precisa ver os nomes reais
  expect(msg).toContain('nio_fabric_ask'); // e o caminho que não exige adivinhar
});

test('DAX válido com várias tabelas reais passa limpo', () => {
  const dax = "EVALUATE SUMMARIZECOLUMNS('CALENDARIO'[Ano], \"n\", COUNTROWS('VISAO_COMERCIAL'))";
  expect(checkDaxTables(dax, INVENTARIO).unknown).toEqual([]);
});

test('função com ponto não vira tabela (INFO.VIEW.TABLES)', () => {
  // Regressão possível: `INFO.VIEW.TABLES()` não tem colchete nem aspas, mas garante.
  expect(checkDaxTables('EVALUATE INFO.VIEW.TABLES()', INVENTARIO).unknown).toEqual([]);
});

test('ACEITE: tabela declarada no DEFINE não é acusada (falso positivo visto em prod)', () => {
  // O agente escrevia `DEFINE C = SELECTCOLUMNS(...)` e depois `C[Table]`. O guard via
  // `C[` e bloqueava, mandando "corrigir o nome" de algo correto — travando TODA
  // consulta com DEFINE antes de sair da máquina.
  const dax = 'DEFINE C = SELECTCOLUMNS(INFO.VIEW.COLUMNS(), "t", [Table]) EVALUATE FILTER(C, C[Table] = "X")';
  expect(checkDaxTables(dax, INVENTARIO).unknown).toEqual([]);
});

test('DEFINE TABLE/VAR/MEASURE/COLUMN: todos os nomes locais são reconhecidos', () => {
  const dax = `DEFINE
    TABLE Z = ADDCOLUMNS(VISAO_COMERCIAL, "x", 1)
    VAR N = 1
    MEASURE VISAO_COMERCIAL[M] = SUM(VISAO_COMERCIAL[total_linha])
  EVALUATE FILTER(Z, Z[x] = N)`;
  expect(checkDaxTables(dax, INVENTARIO).unknown).toEqual([]);
});

test('ACEITE: com DEFINE presente, tabela REALMENTE inexistente continua barrada', () => {
  // A correção não pode virar salvo-conduto: o DEFINE isenta só o que ele declara.
  const dax = 'DEFINE TABLE Z = FILTER(Metas, Metas[v] > 0) EVALUATE Z';
  expect(checkDaxTables(dax, INVENTARIO).unknown).toEqual(['Metas']);
});

test('nome local não vaza entre consultas (a isenção é por DAX)', () => {
  expect(checkDaxTables('EVALUATE FILTER(C, C[x] = 1)', INVENTARIO).unknown).toEqual(['C']);
});
