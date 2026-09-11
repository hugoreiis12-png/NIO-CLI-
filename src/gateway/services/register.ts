/**
 * Registro de usuário — **no gateway** (TP-1). Antes o `nio register` fazia
 * `INSERT INTO user_cli` direto do CLI; com o split de roles (migration 0008) o
 * role `nio_cli` não escreve mais em `user_cli`, então isto passou pra cá.
 */
import type { UserRepository } from '../../core/repositories.js';
import { createUserRepository } from '../../adapters/pg/user-repository.js';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../../lib/auth/password.js';
import { checkPasswordBreach } from '../../lib/auth/breach-check.js';

export type RegisterOutcome =
  | { ok: true; userId: number; name: string; passwordWarning?: 'breached' }
  | { ok: false; reason: 'invalid_name' | 'weak_password' | 'name_taken' };

export async function register(
  name: string,
  password: string,
  deps: { users?: UserRepository } = {},
): Promise<RegisterOutcome> {
  const users = deps.users ?? createUserRepository();
  const clean = name.trim();
  if (!clean || clean.length > 64) return { ok: false, reason: 'invalid_name' };
  if (password.length < MIN_PASSWORD_LENGTH) return { ok: false, reason: 'weak_password' };
  // SP-7 (aviso, não bloqueio): avalia pra todo mundo antes do check de nome —
  // não vaza enumeração (é sobre a senha, não o nome) e o resultado vira aviso
  // no final, sem impedir o cadastro.
  const breached = (await checkPasswordBreach(password)).breached;
  if (await users.findByName(clean)) {
    // TP-3: o nome-tomado retorna 409 (necessário pra UX de unicidade), mas sem
    // isto o caminho "criar" gastaria ~250 ms de argon2 a mais → enumeração por
    // timing. Queima um hash decoy. O rate-limit do Kong (5/min) cobre o resto.
    await hashPassword(password).catch(() => {});
    return { ok: false, reason: 'name_taken' };
  }
  const user = await users.create({ name: clean, password });
  return breached
    ? { ok: true, userId: user.id, name: user.name, passwordWarning: 'breached' as const }
    : { ok: true, userId: user.id, name: user.name };
}
