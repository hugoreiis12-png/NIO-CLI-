import type { DbClient } from '../adapters/supabase/client.js';
import { brand } from '../brand.js';

export interface HistoryEntry {
  task_id: string;
  user_id: string;
  action: string;
  field?: string | null;
  old_value?: string | null;
  new_value?: string | null;
}

export async function insertTaskHistory(
  supabase: DbClient,
  entry: HistoryEntry,
): Promise<void> {
  const { error } = await supabase.from('task_history').insert({
    task_id: entry.task_id,
    user_id: entry.user_id,
    action: entry.action,
    field: entry.field ?? null,
    old_value: entry.old_value ?? null,
    new_value: entry.new_value ?? null,
  });
  if (error) {
    console.error(`[${brand.mcpBinName}] falha ao gravar task_history: ${error.message}`);
  }
}
