import type { SupabaseClient } from '@supabase/supabase-js';
import type { DbClient } from './client.js';
import type { AnalyticsGateway } from '../../core/ports.js';
import type { DeliveryInput } from '../../core/types.js';
import { track as trackUsage, type UsageEvent } from '../../lib/telemetry.js';

/** Adaptador Supabase do `AnalyticsGateway` (entregas + telemetria de uso). */
export function analyticsGateway(db: DbClient): AnalyticsGateway {
  return {
    async recordDelivery(row: DeliveryInput): Promise<void> {
      // `deliveries` ainda não está nos types gerados (rode `gen:types` após a migration)
      // — usamos o client destipado só pra este insert.
      const raw = db as unknown as SupabaseClient;
      const { error } = await raw.from('deliveries').insert(row);
      if (error) throw new Error(`Erro ao registrar entrega: ${error.message}`);
    },

    track(event: UsageEvent): void {
      trackUsage(db, event);
    },
  };
}
