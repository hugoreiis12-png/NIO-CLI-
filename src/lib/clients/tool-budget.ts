/**
 * Orçamento de tools do config do opencode (chave `tools`).
 *
 * Medido: 56 tools = ~12.606 tokens de schema em TODA request. O MCP do excel sozinho
 * traz 25 delas (~4.645 tokens), e 20 são de **edição de planilha** (formatar, gráfico,
 * pivot, mesclar, ranges, linhas/colunas) — capacidade que o fluxo de dados do NIO não
 * usa, já que analisar planilha anexada é feito pelo `tui/attachments.ts`, que converte
 * xlsx em CSV no prompt.
 *
 * Além do token, tool demais degrada a ESCOLHA da tool: 56 opções é muito para um
 * modelo de 27B.
 */
import { env } from '../../brand.js';

/** Nome no opencode = `<id do server MCP>_<nome da tool>`. */
const EXCEL = 'excel_';

/** As 5 que o fluxo de dados usa de fato: ler, inspecionar, escrever e criar. */
export const EXCEL_TOOLS_ESSENCIAIS = [
  'read_data_from_excel',
  'get_workbook_metadata',
  'write_data_to_excel',
  'create_workbook',
  'create_worksheet',
] as const;

/** As 20 de edição de planilha — desligadas por padrão. */
export const EXCEL_TOOLS_EDICAO = [
  'apply_formula',
  'validate_formula_syntax',
  'format_range',
  'create_chart',
  'create_pivot_table',
  'create_table',
  'copy_worksheet',
  'delete_worksheet',
  'rename_worksheet',
  'merge_cells',
  'unmerge_cells',
  'get_merged_cells',
  'copy_range',
  'delete_range',
  'validate_excel_range',
  'get_data_validation_info',
  'insert_rows',
  'insert_columns',
  'delete_sheet_rows',
  'delete_sheet_columns',
] as const;

const ligado = (nome: string): boolean =>
  /^(1|true|yes|on)$/i.test((env(nome) ?? '').trim());

/** Nomes extras a desligar, via `NIO_AI_TOOLS_OFF="a,b,c"`. */
function extrasDesligadas(): string[] {
  return (env('AI_TOOLS_OFF') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Mapa `tools` a gravar no config. `NIO_AI_EXCEL_FULL=1` devolve as 20 de edição;
 * `NIO_AI_TOOLS_OFF` acrescenta qualquer outra.
 *
 * Só escreve `false` — nunca liga tool que o usuário desligou, e não declara as que
 * ficam ativas (ausente já é "ativa" no opencode).
 */
export function buildToolBudget(): Record<string, boolean> {
  const off: Record<string, boolean> = {};
  if (!ligado('AI_EXCEL_FULL')) {
    for (const t of EXCEL_TOOLS_EDICAO) off[`${EXCEL}${t}`] = false;
  }
  for (const t of extrasDesligadas()) off[t] = false;
  return off;
}

/**
 * Funde o orçamento com o que já existe no config. O do **usuário vence**: se ele
 * ligou explicitamente uma tool que desligaríamos, respeitamos.
 */
export function mergeToolBudget(existing: unknown): Record<string, boolean> | undefined {
  const doUsuario = (existing ?? {}) as Record<string, boolean>;
  const merged = { ...buildToolBudget(), ...doUsuario };
  return Object.keys(merged).length > 0 ? merged : undefined;
}
