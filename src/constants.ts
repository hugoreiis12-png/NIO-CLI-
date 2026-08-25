import { brand, homePath } from './brand.js';

/** Sessão local v2 (`nio login` contra `user_cli`/Postgres) — `~/.nio/session.json`. */
export const SESSION_FILE = homePath('session.json');

export const PROJECT_CONFIG_FILE = brand.projectConfigFile;
