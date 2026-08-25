/**
 * Tipos de domínio da investigação read-only dual-IP (`InvestigationGateway`,
 * ver `core/ports.ts` e `adapters/postgres/`). Sem vínculo com backend nenhum.
 *
 * Os tipos v1 (tasks/sprints/alocação) que viviam aqui foram removidos na
 * migração v1→v2 junto com o `Gateway` legado.
 */

/**
 * Destino de banco na investigação read-only dual-IP (P01 do roadmap):
 * `primary` = banco novo (192.168.0.142), `secondary` = banco antigo
 * (192.168.0.250). Nunca há default silencioso — o destino é sempre explícito
 * (Invariante #4). O mapa host→destino vive em `adapters/postgres/targets.ts`.
 */
export type DbTarget = 'primary' | 'secondary';

/** Resultado cru de uma consulta read-only de investigação. */
export interface QueryResult {
  /** Linhas como objetos coluna→valor, na ordem em que o banco devolveu. */
  rows: Record<string, unknown>[];
  /** Número de linhas retornadas. */
  rowCount: number;
  /** Nomes das colunas na ordem do SELECT (p/ render tabular estável). */
  fields: string[];
}
