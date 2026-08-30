import type {
  DbTarget,
  QueryResult,
} from './types.js';

/**
 * Investigação READ-ONLY sobre os bancos PostgreSQL dual-IP (`primary` = novo,
 * `secondary` = antigo). Contrato de erro: **lança** `Error` (mensagem pronta)
 * em falha de conexão, destino não configurado, ou consulta não-DQL.
 *
 * Invariantes (roadmap Fase 1):
 *  - **Destino sempre explícito** — nunca um default silencioso (#4).
 *  - **Somente DQL** — a implementação rejeita não-`SELECT` **antes da rede**
 *    (guarda no código) E abre a sessão do banco como read-only; a role
 *    DQL-only do Postgres é a terceira camada, autoritativa (F12-T3 + F15).
 *
 * Fala com os Postgres pelo driver `pg` (sessão read-only), não pelo `Pool` do
 * `nio_cli` (`adapters/pg/`) — é outro banco, sem auth por-usuário.
 */
export interface InvestigationGateway {
  /** Consulta read-only no destino explícito. `params` são placeholders posicionais. */
  query(target: DbTarget, sql: string, params?: unknown[]): Promise<QueryResult>;
}
