/**
 * Contrato dos helpers das tools `nio_fabric_*`. Os dois existem por causa de token:
 * o adapter repassa o OData cru e a API permite 100k linhas — despejar isso no contexto
 * é desperdício e chega a estourar a janela.
 */
import { test, expect } from 'bun:test';
import { leanList, capRows } from './fabric-shared.js';
import { NIO_FABRIC_MAX_ROWS } from '../lib/clients/client-configs.js';
import type { FabricRow } from '../core/fabric.js';

test('leanList projeta só id+name — descarta o resto do OData', () => {
  const cru = [
    {
      id: 'a',
      name: 'COMERCIAL',
      webUrl: 'https://app.powerbi.com/muito/longo',
      qnaEmbedURL: 'https://outro/longo',
      isRefreshable: true,
    },
  ];
  expect(leanList(cru)).toEqual([{ id: 'a', name: 'COMERCIAL' }]);
});

test('leanList em lista vazia não quebra', () => {
  expect(leanList([])).toEqual([]);
});

test('capRows: abaixo dos tetos devolve tudo, sem marcador', () => {
  const rows: FabricRow[] = [{ a: 1 }, { a: 2 }];
  const out = capRows(rows);
  expect(out.rows).toHaveLength(2);
  expect(out.row_count).toBe(2);
  expect(out.truncado).toBeUndefined();
});

test('capRows: corta pela CONTAGEM e reporta o total real', () => {
  const rows: FabricRow[] = Array.from({ length: 500 }, (_, i) => ({ i }));
  const out = capRows(rows);
  expect(out.rows).toHaveLength(NIO_FABRIC_MAX_ROWS);
  expect(out.row_count).toBe(500); // o total real nunca é escondido
  expect(out.truncado).toContain('de 500 linhas');
  expect(out.truncado).toContain('SUMMARIZECOLUMNS'); // diz o que fazer no lugar
});

test('capRows: corta pelo TAMANHO quando as linhas são largas', () => {
  // 40 linhas gordas: estouram o orçamento de chars antes do teto de contagem
  const gorda = Object.fromEntries(
    Array.from({ length: 20 }, (_, c) => [`[Coluna_${c}]`, 'V'.repeat(80)]),
  );
  const rows: FabricRow[] = Array.from({ length: 40 }, () => ({ ...gorda }));
  const out = capRows(rows);

  expect(out.rows.length).toBeLessThan(40);
  expect(out.rows.length).toBeLessThan(NIO_FABRIC_MAX_ROWS); // contagem não foi o limite
  expect(out.row_count).toBe(40);
  expect(out.truncado).toBeDefined();
});

test('capRows: uma única linha gigante ainda é devolvida (zero linha seria pior)', () => {
  const rows: FabricRow[] = [{ big: 'X'.repeat(50_000) }];
  const out = capRows(rows);
  expect(out.rows).toHaveLength(1);
  expect(out.row_count).toBe(1);
});

test('capRows: lista vazia', () => {
  const out = capRows([]);
  expect(out.rows).toEqual([]);
  expect(out.row_count).toBe(0);
  expect(out.truncado).toBeUndefined();
});