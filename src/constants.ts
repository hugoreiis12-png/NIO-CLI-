import { brand, homePath, patRegex } from './brand.js';

export const SUPABASE_URL = brand.supabaseUrl;
export const SUPABASE_ANON_KEY = brand.supabaseAnonKey;

export const TOKEN_EXCHANGE_URL = `${SUPABASE_URL}/functions/v1/mcp-token-exchange`;

export const CREDENTIALS_DIR = homePath();
export const CREDENTIALS_FILE = homePath('credentials.json');

export const PROJECT_CONFIG_FILE = brand.projectConfigFile;

export const PAT_REGEX = patRegex;
