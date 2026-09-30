/**
 * Guarda o refresh token do device code em `~/.nio/fabric-auth.json`.
 *
 * É segredo de longa duração: o arquivo nasce com permissão só do dono
 * (`hardenSecretFile`) e o valor nunca é logado nem mostrado na UI. Fica fora do
 * `config.env` de propósito — aquele é config da equipe, este é sessão pessoal e
 * some com `nio fabric logout`.
 */
import { readFileSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { hardenSecretFile } from '../../lib/secure-file.js';

const nioDir = (): string => join(homedir(), '.nio');
/** `at` existe para o teste apontar para um tmpdir e não tocar no login real. */
export const authPath = (at: string = nioDir()): string => join(at, 'fabric-auth.json');

interface StoredAuth {
  refreshToken: string;
  savedAt: string;
  /** Tenant+client de origem: credencial trocada invalida o refresh guardado. */
  tenantId?: string;
  clientId?: string;
}

/** O refresh token salvo, ou `null` se não há, está ilegível ou é de outra credencial. */
export function readRefreshToken(
  tenantId?: string,
  clientId?: string,
  path: string = authPath(),
): string | null {
  try {
    const raw = readFileSync(path, 'utf8');
    const j = JSON.parse(raw) as StoredAuth;
    if (!j.refreshToken) return null;
    // Trocou de tenant/app? O refresh antigo não vale — evita erro opaco do Entra.
    if (tenantId && j.tenantId && j.tenantId !== tenantId) return null;
    if (clientId && j.clientId && j.clientId !== clientId) return null;
    return j.refreshToken;
  } catch {
    return null; // ausente ou corrompido: tratado como "não logado"
  }
}

/** Grava o refresh token. Devolve o aviso de permissão, se o hardening falhar. */
export function saveRefreshToken(
  refreshToken: string,
  auth: { tenantId?: string; clientId?: string } = {},
  path: string = authPath(),
): { warning?: string } {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const body: StoredAuth = {
    refreshToken,
    savedAt: new Date().toISOString(),
    tenantId: auth.tenantId,
    clientId: auth.clientId,
  };
  writeFileSync(path, JSON.stringify(body, null, 2), { encoding: 'utf8', mode: 0o600 });
  const hard = hardenSecretFile(path);
  return hard.outcome === 'ok' ? {} : { warning: hard.error };
}

/** Esquece o login. Idempotente — sair duas vezes não é erro. */
export function clearRefreshToken(path: string = authPath()): void {
  try {
    rmSync(path, { force: true });
  } catch {
    /* já não existe */
  }
}
