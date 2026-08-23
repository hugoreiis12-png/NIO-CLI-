import { brand, homePath, patRegex } from './brand.js';

export const SUPABASE_URL = brand.supabaseUrl;
export const SUPABASE_ANON_KEY = brand.supabaseAnonKey;

export const TOKEN_EXCHANGE_URL = `${SUPABASE_URL}/functions/v1/mcp-token-exchange`;

export const CREDENTIALS_DIR = homePath();
export const CREDENTIALS_FILE = homePath('credentials.json');

/** Sessão local v2 (`nio login` contra `user_cli`/Postgres) — arquivo próprio,
 * separado do `credentials.json` do fluxo PAT/Supabase v1. */
export const SESSION_FILE = homePath('session.json');

export const PROJECT_CONFIG_FILE = brand.projectConfigFile;

export const PAT_REGEX = patRegex;
