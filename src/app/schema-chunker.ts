/**
 * Transforma o schema do modelo semântico (linhas de `INFO.VIEW.*`) em chunks para
 * o índice vetorial. Puro — sem IO, sem embedding.
 *
 * Por que schema e não documentação: os erros reais eram `Cannot find table 'Metas'`
 * — nome inventado. A documentação da Microsoft ensina sintaxe; ela não sabe que a
 * tabela se chama `VISAO_COMERCIAL`. O schema, sim.
 *
 * Granularidade: 1 chunk por **tabela** (com suas colunas) + 1 por **medida**. Medida
 * isolada é curta e precisa — a busca acha a certa pelo nome/semântica. E há um chunk
 * de **inventário** com todas as tabelas, que o orquestrador injeta sempre (é barato e
 * é o que mais evita nome inventado).
 */
import { createHash } from 'node:crypto';
import type { FabricRow } from '../core/fabric.js';
import type { DocChunk } from '../core/rag.js';

/** Caminho estável do chunk de inventário — o orquestrador o busca por path. */
export const INVENTORY_PATH = '_inventario_tabelas';

/** Colunas do `INFO.VIEW.*` chegam entre colchetes: `[Name]`, `[Table]`… */
function cell(row: FabricRow, key: string): string {
  const v = row[`[${key}]`];
  return v === null || v === undefined ? '' : String(v).trim();
}

function isHidden(row: FabricRow): boolean {
  return cell(row, 'IsHidden').toLowerCase() === 'true';
}

/** `repo` do chunk: o schema é por modelo semântico, não por repositório. */
export function schemaRepo(datasetId: string): string {
  return `model:${datasetId}`;
}

/** `ref` = hash do conteúdo: schema inalterado → mesmo ref → reingestão é no-op. */
export function schemaRef(chunks: DocChunk[]): string {
  const h = createHash('sha256');
  for (const c of chunks) h.update(c.path).update('\u0000').update(c.content).update('\u0000');
  return h.digest('hex').slice(0, 16);
}

/** Texto de uma tabela com as colunas que pertencem a ela. */
function tableChunk(table: FabricRow, columns: FabricRow[]): string {
  const name = cell(table, 'Name');
  const cols = columns
    .filter((c) => cell(c, 'Table') === name && !isHidden(c))
    .map((c) => {
      const type = cell(c, 'DataType');
      return type ? `${cell(c, 'Name')} (${type})` : cell(c, 'Name');
    });
  const lines = [`Tabela: ${name}`];
  const desc = cell(table, 'Description');
  if (desc) lines.push(`Descrição: ${desc}`);
  const storage = cell(table, 'StorageMode');
  if (storage) lines.push(`Armazenamento: ${storage}`);
  lines.push(cols.length > 0 ? `Colunas: ${cols.join(', ')}` : 'Colunas: (nenhuma visível)');
  return lines.join('\n');
}

/** Texto de uma medida — curto de propósito, pra a busca ser precisa. */
function measureChunk(measure: FabricRow): string {
  const lines = [`Medida: ${cell(measure, 'Name')}`, `Tabela: ${cell(measure, 'Table')}`];
  const type = cell(measure, 'DataType');
  if (type) lines.push(`Tipo: ${type}`);
  const folder = cell(measure, 'DisplayFolder');
  if (folder) lines.push(`Pasta: ${folder}`);
  const desc = cell(measure, 'Description');
  if (desc) lines.push(`Descrição: ${desc}`);
  // Hoje o `INFO.VIEW.MEASURES()` deste tenant devolve `[Expression]` nulo (medido) e o
  // chunk fica só com a identidade. Quando a fórmula vier, ela entra — é o que permite
  // ao modelo conferir o cálculo em vez de só chamar a medida às cegas.
  const expression = cell(measure, 'Expression');
  if (expression) lines.push(`Expressão DAX: ${expression}`);
  return lines.join('\n');
}

export interface SchemaRows {
  tables: FabricRow[];
  measures: FabricRow[];
  columns: FabricRow[];
}

/**
 * Monta os chunks do schema. Tabelas ocultas (auto date/time do Power BI:
 * `LocalDateTable_*`, `DateTableTemplate_*`) são descartadas — são ruído gerado,
 * não vocabulário do negócio.
 */
export function buildSchemaChunks(rows: SchemaRows, datasetId: string): DocChunk[] {
  const repo = schemaRepo(datasetId);
  const visibleTables = rows.tables.filter((t) => !isHidden(t) && cell(t, 'Name') !== '');
  const chunks: DocChunk[] = [];

  // Inventário primeiro: é o que o orquestrador injeta sempre.
  const names = visibleTables.map((t) => cell(t, 'Name'));
  chunks.push({
    repo,
    ref: '',
    path: INVENTORY_PATH,
    heading: 'Tabelas do modelo',
    content: `Tabelas do modelo semântico (${names.length}): ${names.join(', ')}`,
  });

  for (const t of visibleTables) {
    chunks.push({
      repo,
      ref: '',
      path: `tabela/${cell(t, 'Name')}`,
      heading: cell(t, 'Name'),
      content: tableChunk(t, rows.columns),
    });
  }

  for (const m of rows.measures) {
    if (isHidden(m) || cell(m, 'Name') === '') continue;
    chunks.push({
      repo,
      ref: '',
      path: `medida/${cell(m, 'Table')}/${cell(m, 'Name')}`,
      heading: cell(m, 'Name'),
      content: measureChunk(m),
    });
  }

  // O ref depende do conteúdo de todos os chunks → calcula depois e carimba.
  const ref = schemaRef(chunks);
  return chunks.map((c) => ({ ...c, ref }));
}
