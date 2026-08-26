/**
 * Implementação Postgres do `DependencyEventRepository` (port em
 * `core/repositories.ts`). Persiste os eventos que o watcher detecta na tabela
 * `dependency_events`. `recordIfNew` faz o dedupe (session+file+name) numa
 * transação pra não criar duas linhas iguais em ticks concorrentes.
 */
import type { DependencyEvent, DependencyType } from '../../core/session.js';
import type {
  DependencyEventRepository,
  NewDependencyEventInput,
} from '../../core/repositories.js';
import { query, withTransaction } from './client.js';

/** Linha crua de `dependency_events` (snake_case). */
export interface DependencyEventRow {
  id: string;
  session_id: string;
  file_path: string;
  dependency_name: string;
  dependency_type: string;
  detected_at: Date;
  installed: boolean;
  installed_at: Date | null;
}

const COLS =
  'id, session_id, file_path, dependency_name, dependency_type, detected_at, installed, installed_at';

export function mapDependencyEventRow(row: DependencyEventRow): DependencyEvent {
  return {
    id: row.id,
    sessionId: row.session_id,
    filePath: row.file_path,
    dependencyName: row.dependency_name,
    dependencyType: row.dependency_type as DependencyType,
    detectedAt: row.detected_at,
    installed: row.installed,
    installedAt: row.installed_at,
  };
}

export function createDependencyEventRepository(): DependencyEventRepository {
  return {
    async recordIfNew(input: NewDependencyEventInput) {
      return withTransaction(async (tx) => {
        // Já existe um evento pro trio? Dedupe (o watcher re-detecta a cada tick).
        const existing = await tx.query<DependencyEventRow>(
          `SELECT ${COLS} FROM dependency_events
           WHERE session_id = $1 AND file_path = $2 AND dependency_name = $3
           ORDER BY detected_at DESC LIMIT 1`,
          [input.sessionId, input.filePath, input.dependencyName],
        );
        if (existing.rows[0]) {
          return { event: mapDependencyEventRow(existing.rows[0]), created: false };
        }
        const inserted = await tx.query<DependencyEventRow>(
          `INSERT INTO dependency_events (session_id, file_path, dependency_name, dependency_type)
           VALUES ($1, $2, $3, $4)
           RETURNING ${COLS}`,
          [input.sessionId, input.filePath, input.dependencyName, input.dependencyType],
        );
        return { event: mapDependencyEventRow(inserted.rows[0]!), created: true };
      });
    },

    async markInstalled(id) {
      await query(
        `UPDATE dependency_events SET installed = TRUE, installed_at = NOW() WHERE id = $1`,
        [id],
      );
    },

    async listBySession(sessionId) {
      const res = await query<DependencyEventRow>(
        `SELECT ${COLS} FROM dependency_events WHERE session_id = $1 ORDER BY detected_at DESC`,
        [sessionId],
      );
      return res.rows.map(mapDependencyEventRow);
    },
  };
}
