/**
 * Integração do `AuthEventRepository` contra o Postgres real (ADR 0012).
 * Gated em `NIO_DATABASE_URL`. Usuário descartável.
 */
import { test, expect, afterAll } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { createUserRepository } from './user-repository.js';
import { createAuthEventRepository } from './auth-event-repository.js';
import { query, closePool } from './client.js';

const dbTest = process.env.NIO_DATABASE_URL ? test : test.skip;
afterAll(async () => {
  if (process.env.NIO_DATABASE_URL) await closePool();
});

dbTest('record + recentFailures (por userId e por name) + prune', async () => {
  const users = createUserRepository();
  const repo = createAuthEventRepository();
  const user = await users.create({ name: `nio-ae-${randomUUID()}`, password: `pw-${randomUUID()}` });
  const ghostName = `fantasma-${randomUUID()}`;
  try {
    await repo.record({ event: 'password_ok', userId: user.id, ip: '203.0.113.1', name: user.name });
    await repo.record({ event: 'password_fail', userId: user.id, ip: '203.0.113.2', name: user.name, detail: { reason: 'x' } });
    await repo.record({ event: '2fa_fail', userId: user.id, ip: '203.0.113.3', name: user.name });
    await repo.record({ event: 'password_fail', name: ghostName, ip: '198.51.100.9' }); // conta inexistente

    // por userId → só as falhas, mais recente primeiro, sem o password_ok
    const byUser = await repo.recentFailures({ userId: user.id, limit: 10 });
    expect(byUser.map((f) => f.event)).toEqual(['2fa_fail', 'password_fail']);
    expect(byUser[0]!.ip).toBe('203.0.113.3');

    // por name (spray em conta que não existe)
    const byName = await repo.recentFailures({ name: ghostName });
    expect(byName).toHaveLength(1);
    expect(byName[0]!.event).toBe('password_fail');

    // cap 128 no name
    await repo.record({ event: 'password_fail', name: 'a'.repeat(300), ip: '198.51.100.10' });
    const long = await repo.recentFailures({ name: 'a'.repeat(128) });
    expect(long).toHaveLength(1);

    // retenção
    await query(`UPDATE auth_events SET at = NOW() - INTERVAL '400 days' WHERE user_id = $1`, [user.id]);
    const pruned = await repo.pruneOlderThan(180);
    expect(pruned).toBe(3);
    expect(await repo.recentFailures({ userId: user.id })).toHaveLength(0);
  } finally {
    await query('DELETE FROM user_cli WHERE id = $1', [user.id]);
    await query(`DELETE FROM auth_events WHERE name = $1 OR name = $2`, [ghostName, 'a'.repeat(128)]);
  }
}, 20_000);
