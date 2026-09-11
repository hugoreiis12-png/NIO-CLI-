import { describe, expect, test } from 'bun:test';
// SP-7: sem rede nos testes — só a checagem local (lista de senhas comuns) roda.
process.env.NIO_HIBP_DISABLE = '1';
import { register } from './register.js';
import type { UserRepository } from '../../core/repositories.js';
import type { UserCli } from '../../core/types.js';

function fakeUsers(existing: string[] = []): { users: UserRepository; created: string[] } {
  const created: string[] = [];
  const users = {
    async findByName(name: string) {
      return existing.includes(name) ? ({ id: 1, name } as UserCli) : null;
    },
    async create({ name }: { name: string; password: string }) {
      created.push(name);
      return { id: 42, name } as UserCli;
    },
  } as unknown as UserRepository;
  return { users, created };
}

describe('register', () => {
  test('cria usuário novo', async () => {
    const { users, created } = fakeUsers();
    const out = await register('  Ana  ', 'senha-forte-1', { users });
    expect(out).toEqual({ ok: true, userId: 42, name: 'Ana' });
    expect(created).toEqual(['Ana']);
  });

  test('nome vazio → invalid_name', async () => {
    const { users } = fakeUsers();
    expect(await register('   ', 'senha-forte-1', { users })).toEqual({ ok: false, reason: 'invalid_name' });
  });

  test('nome > 64 chars → invalid_name', async () => {
    const { users } = fakeUsers();
    expect(await register('x'.repeat(65), 'senha-forte-1', { users })).toEqual({
      ok: false,
      reason: 'invalid_name',
    });
  });

  test('senha curta → weak_password', async () => {
    const { users, created } = fakeUsers();
    expect(await register('Ana', 'curta', { users })).toEqual({ ok: false, reason: 'weak_password' });
    expect(created).toEqual([]);
  });

  test('nome já em uso → name_taken', async () => {
    const { users } = fakeUsers(['Ana']);
    expect(await register('Ana', 'senha-forte-1', { users })).toEqual({ ok: false, reason: 'name_taken' });
  });

  test('senha comum (lista local) → cria com passwordWarning, não bloqueia', async () => {
    const { users, created } = fakeUsers();
    expect(await register('Ana', 'password', { users })).toEqual({
      ok: true,
      userId: 42,
      name: 'Ana',
      passwordWarning: 'breached',
    });
    expect(created).toEqual(['Ana']);
  });

  test('senha forte → cria sem warning', async () => {
    const { users } = fakeUsers();
    const out = await register('Ana', 'senha-forte-1', { users });
    expect(out).toEqual({ ok: true, userId: 42, name: 'Ana' });
    expect('passwordWarning' in out).toBe(false);
  });
});
