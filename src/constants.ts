import { brand, homePath } from './brand.js';

/** Sessão local v2 (`nio login` contra `user_cli`/Postgres) — arquivo próprio,
 * separado do `credentials.json` do fluxo PAT/Supabase v1. */
export const SESSION_FILE = homePath('session.json');

export const PROJECT_CONFIG_FILE = brand.projectConfigFile;
