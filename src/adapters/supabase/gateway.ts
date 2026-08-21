import type { DbClient } from './client.js';
import type { Gateway } from '../../core/ports.js';
import { contextGateway } from './context-gateway.js';
import { taskGateway } from './task-gateway.js';
import { allocationGateway } from './allocation-gateway.js';
import { analyticsGateway } from './analytics-gateway.js';

/**
 * Adaptador Supabase da `Gateway`, composto pelos gateways de domínio. Toda query
 * PostgREST vive nos módulos `*-gateway.ts` — este arquivo só junta as peças.
 * Cada método lança `Error` em falha de backend; a tool traduz para `errorResult`.
 */
export function createSupabaseGateway(db: DbClient): Gateway {
  return {
    ...contextGateway(db),
    ...taskGateway(db),
    ...allocationGateway(db),
    ...analyticsGateway(db),
  };
}
