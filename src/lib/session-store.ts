/**
 * Persistência local da sessão v2 (`nio login` contra `user_cli`/Postgres) —
 * separado de `src/auth.ts` (fluxo PAT→Supabase do v1, candidato a remoção).
 * Guarda {userId, name, token, loggedInAt} em `~/.nio/session.json`, chmod
 * 600, mesma convenção de segurança do antigo `credentials.json`.
 */
import { mkdir, readFile, writeFile, rm, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
import { SESSION_FILE } from '../constants.js';

export interface StoredSession {
  userId: number;
  name: string;
  token: string;
  loggedInAt: string;
}

/** Parse tolerante — `null` se o shape não bate (ausente, corrompido, ou de outra versão). */
export function parseStoredSession(raw: unknown): StoredSession | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (
    typeof s.userId === 'number' &&
    typeof s.name === 'string' &&
    typeof s.token === 'string' &&
    typeof s.loggedInAt === 'string'
  ) {
    return { userId: s.userId, name: s.name, token: s.token, loggedInAt: s.loggedInAt };
  }
  return null;
}

export async function loadSession(file: string = SESSION_FILE): Promise<StoredSession | null> {
  try {
    const raw = await readFile(file, 'utf8');
    return parseStoredSession(JSON.parse(raw));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function saveSession(session: StoredSession, file: string = SESSION_FILE): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(session, null, 2) + '\n', 'utf8');
  try {
    await chmod(file, 0o600);
  } catch {
    // chmod pode falhar em Windows — ignoramos silenciosamente.
  }
}

export async function clearSession(file: string = SESSION_FILE): Promise<void> {
  await rm(file, { force: true });
}
