import { test, expect } from 'bun:test';
import {
  buildToolBudget,
  mergeToolBudget,
  EXCEL_TOOLS_ESSENCIAIS,
  EXCEL_TOOLS_EDICAO,
} from './tool-budget.js';

test('as 25 tools do excel se dividem em 5 essenciais + 20 de edição', () => {
  expect(EXCEL_TOOLS_ESSENCIAIS).toHaveLength(5);
  expect(EXCEL_TOOLS_EDICAO).toHaveLength(20);
});

test('ACEITE: edição de planilha sai, leitura/escrita fica', () => {
  // Analisar planilha anexada não usa o MCP — `attachments.ts` converte xlsx em CSV.
  // O que sobra é manipular arquivo, e disso o fluxo de dados só precisa ler e gravar.
  const off = buildToolBudget();
  for (const t of EXCEL_TOOLS_EDICAO) expect(off[`excel_${t}`]).toBe(false);
  for (const t of EXCEL_TOOLS_ESSENCIAIS) expect(`excel_${t}` in off).toBe(false);
});

test('só declara desligamento — nunca liga tool por conta própria', () => {
  expect(Object.values(buildToolBudget()).every((v) => v === false)).toBe(true);
});

test('a escolha do usuário vence a nossa', () => {
  const merged = mergeToolBudget({ excel_create_chart: true });
  expect(merged!.excel_create_chart).toBe(true); // ele religou: respeitamos
  expect(merged!.excel_merge_cells).toBe(false); // as outras seguem cortadas
});

test('config sem nada a desligar não grava a chave (não polui o arquivo)', () => {
  const antes = process.env.NIO_AI_EXCEL_FULL;
  process.env.NIO_AI_EXCEL_FULL = '1';
  try {
    // `buildToolBudget` lê env em tempo de chamada — com FULL e sem extras, fica vazio.
    expect(mergeToolBudget(undefined)).toBeUndefined();
  } finally {
    if (antes === undefined) delete process.env.NIO_AI_EXCEL_FULL;
    else process.env.NIO_AI_EXCEL_FULL = antes;
  }
});
