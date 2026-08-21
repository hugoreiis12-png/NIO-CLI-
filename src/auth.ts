import { mkdir, readFile, writeFile, chmod, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  CREDENTIALS_FILE,
  PAT_REGEX,
  SUPABASE_ANON_KEY,
  TOKEN_EXCHANGE_URL,
} from './constants.js';
import { env } from './brand.js';

export interface CachedUser {
  id: string;
  email: string;
  full_name: string | null;
  username: string | null;
}

// `user`/`fetched_at` são opcionais: credencial legada só-`pat` continua válida.
export interface Credentials {
  pat: string;
  user?: CachedUser;
  fetched_at?: string;
}

export interface Identity extends CachedUser {
  fetched_at: string;
}

export interface ExchangeResult {
  access_token: string;
  expires_in: number;
  token_type: string;
  user: CachedUser;
}

export async function loadCredentials(
  file: string = CREDENTIALS_FILE,
): Promise<Credentials | null> {
  const stored = await readCredentialsFile(file);
  // Precedência pro ambiente: usado por Desktop Extensions / Cowork, onde o PAT
  // chega via user_config (NIO_PAT) em vez de `nio login`.
  const envPat = env('PAT')?.trim();
  if (envPat) {
    // Cache do arquivo só serve se for do mesmo PAT.
    return stored?.pat === envPat ? stored : { pat: envPat };
  }
  return stored;
}

async function readCredentialsFile(file: string): Promise<Credentials | null> {
  try {
    const raw = await readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as Credentials;
    if (!parsed || typeof parsed.pat !== 'string') {
      return null;
    }
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

export async function saveCredentials(
  creds: Credentials,
  file: string = CREDENTIALS_FILE,
): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(creds, null, 2) + '\n', 'utf8');
  try {
    await chmod(file, 0o600);
  } catch {
    // chmod pode falhar em Windows — ignoramos silenciosamente.
  }
}

/**
 * Identidade do cache quando houver; senão uma troca de PAT, populando o cache.
 * 401/403 invalida o cache e propaga o erro (o chamador pede re-login).
 */
export async function resolveIdentity(
  creds: Credentials,
  opts: { refresh?: boolean; file?: string } = {},
): Promise<Identity> {
  const file = opts.file ?? CREDENTIALS_FILE;
  if (!opts.refresh && creds.user && creds.fetched_at) {
    return { ...creds.user, fetched_at: creds.fetched_at };
  }

  let result: ExchangeResult;
  try {
    result = await exchangePatForJwt(creds.pat);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401 || status === 403) {
      await patchCachedUser(file, null);
    }
    throw err;
  }

  const identity: Identity = { ...result.user, fetched_at: new Date().toISOString() };
  await patchCachedUser(file, identity);
  return identity;
}

// Só mexe num arquivo já existente: ambiente com PAT via env e sem credencial
// gravada responde sem persistir nada.
async function patchCachedUser(file: string, identity: Identity | null): Promise<void> {
  const creds = await readCredentialsFile(file).catch(() => null);
  if (!creds) return;
  if (identity) {
    const { fetched_at, ...user } = identity;
    creds.user = user;
    creds.fetched_at = fetched_at;
  } else {
    delete creds.user;
    delete creds.fetched_at;
  }
  await saveCredentials(creds, file).catch(() => {
    // filesystem read-only — cache é conveniência, segue sem persistir.
  });
}

export async function clearCredentials(): Promise<void> {
  await rm(CREDENTIALS_FILE, { force: true });
}

export function validatePatFormat(pat: string): boolean {
  return PAT_REGEX.test(pat);
}

export async function exchangePatForJwt(pat: string): Promise<ExchangeResult> {
  const response = await fetch(TOKEN_EXCHANGE_URL, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ token: pat }),
  });

  if (!response.ok) {
    let message = response.statusText;
    try {
      const body = (await response.json()) as { error?: string };
      if (body && typeof body.error === 'string' && body.error.length > 0) {
        message = body.error;
      }
    } catch {
      // body não era JSON — mantém statusText
    }
    const err = new Error(message) as Error & { status: number };
    err.status = response.status;
    throw err;
  }

  return (await response.json()) as ExchangeResult;
}
