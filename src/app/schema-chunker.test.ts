/**
 * Contrato do chunker de schema. O caso que mais importa é o filtro de tabelas
 * ocultas: o modelo real tem 9 tabelas `LocalDateTable_*`/`DateTableTemplate_*`
 * geradas pela auto date/time do Power BI — ruído que envenenaria a recuperação.
 */
import { test, expect } from 'bun:test';
import { buildSchemaChunks, schemaRef, INVENTORY_PATH } from './schema-chunker.js';
import type { FabricRow } from '../core/fabric.js';

const tabela = (name: string, hidden = false, extra: Record<string, unknown> = {}): FabricRow => ({
  '[Name]': name,
  '[IsHidden]': hidden ? 'true' : 'false',
  ...extra,
});
const coluna = (name: string, table: string, type = 'Number'): FabricRow => ({
  '[Name]': name,
  '[Table]': table,
  '[DataType]': type,
  '[IsHidden]': 'false',
});
const medida = (name: string, table: string, extra: Record<string, unknown> = {}): FabricRow => ({
  '[Name]': name,
  '[Table]': table,
  '[DataType]': 'Number',
  '[IsHidden]': 'false',
  ...extra,
});

const ROWS = {
  tables: [
    tabela('VISAO_COMERCIAL', false, { '[StorageMode]': 'Import' }),
    tabela('CALENDARIO'),
    tabela('LocalDateTable_6ff5aa24', true), // auto date/time — deve sumir
    tabela('DateTableTemplate_31754478', true), // idem
  ],
  columns: [
    coluna('VALOR', 'VISAO_COMERCIAL'),
    coluna('DATA', 'CALENDARIO', 'DateTime'),
    coluna('OCULTA', 'VISAO_COMERCIAL'),
  ],
  measures: [medida('TOTAL_LIQUIDO', 'VISAO_COMERCIAL'), medida('OCULTA', 'VISAO_COMERCIAL', { '[IsHidden]': 'true' })],
};

test('descarta tabelas ocultas (auto date/time) — não viram vocabulário', () => {
  const chunks = buildSchemaChunks(ROWS, 'ds');
  const texto = chunks.map((c) => c.content).join('\n');
  expect(texto).not.toContain('LocalDateTable');
  expect(texto).not.toContain('DateTableTemplate');
  expect(texto).toContain('VISAO_COMERCIAL');
});

test('gera inventário com as tabelas visíveis, num path estável', () => {
  const inv = buildSchemaChunks(ROWS, 'ds').find((c) => c.path === INVENTORY_PATH);
  expect(inv).toBeDefined();
  expect(inv!.content).toContain('VISAO_COMERCIAL');
  expect(inv!.content).toContain('CALENDARIO');
  expect(inv!.content).toContain('(2)'); // só as visíveis entram na contagem
});

test('chunk de tabela lista as colunas dela — e só as dela', () => {
  const t = buildSchemaChunks(ROWS, 'ds').find((c) => c.path === 'tabela/CALENDARIO')!;
  expect(t.content).toContain('DATA (DateTime)');
  expect(t.content).not.toContain('VALOR'); // coluna de outra tabela
});

test('chunk de medida carrega nome + tabela (o que evita nome inventado)', () => {
  const m = buildSchemaChunks(ROWS, 'ds').find((c) => c.path.startsWith('medida/'))!;
  expect(m.content).toContain('Medida: TOTAL_LIQUIDO');
  expect(m.content).toContain('Tabela: VISAO_COMERCIAL');
});

test('medida oculta não entra', () => {
  const paths = buildSchemaChunks(ROWS, 'ds').map((c) => c.path);
  expect(paths.filter((p) => p.startsWith('medida/'))).toEqual(['medida/VISAO_COMERCIAL/TOTAL_LIQUIDO']);
});

test('repo é por dataset — schema de um modelo não mistura com o de outro', () => {
  const a = buildSchemaChunks(ROWS, 'ds-A')[0]!;
  const b = buildSchemaChunks(ROWS, 'ds-B')[0]!;
  expect(a.repo).toBe('model:ds-A');
  expect(b.repo).toBe('model:ds-B');
});

test('ref é estável pro mesmo schema e muda quando o schema muda (reingestão idempotente)', () => {
  const a = buildSchemaChunks(ROWS, 'ds');
  const b = buildSchemaChunks(ROWS, 'ds');
  expect(a[0]!.ref).toBe(b[0]!.ref);
  expect(a[0]!.ref).not.toBe('');

  const mudou = buildSchemaChunks(
    { ...ROWS, measures: [...ROWS.measures, medida('NOVA', 'VISAO_COMERCIAL')] },
    'ds',
  );
  expect(mudou[0]!.ref).not.toBe(a[0]!.ref);
});

test('todos os chunks do mesmo build compartilham o ref', () => {
  const chunks = buildSchemaChunks(ROWS, 'ds');
  const refs = new Set(chunks.map((c) => c.ref));
  expect(refs.size).toBe(1);
});

test('schemaRef não depende da ordem de leitura do conteúdo idêntico', () => {
  const chunks = buildSchemaChunks(ROWS, 'ds');
  expect(schemaRef(chunks)).toBe(schemaRef(chunks));
});

test('tabela sem colunas visíveis não quebra', () => {
  const chunks = buildSchemaChunks({ tables: [tabela('VAZIA')], columns: [], measures: [] }, 'ds');
  const t = chunks.find((c) => c.path === 'tabela/VAZIA')!;
  expect(t.content).toContain('nenhuma visível');
});
