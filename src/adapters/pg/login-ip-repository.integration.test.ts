/**
 * Integração do `LoginIpRepository` contra o Postgres real (ADR 0011 §F).
 * Gated em `NIO_DATABASE_URL` (sem ele → pula). Usuário descartável.
 */
import { test, expect, afterAll } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { createUserRepository } from './user-repository.js';
import { createLoginIpRepository } from './login-ip-repository.js';
import { query, closePool } from './client.js';

const dbTest = process.env.NIO_DATABASE_URL ? test : test.skip;
afterAll(async () => {
  if (process.env.NIO_DATABASE_URL) await closePool();
});

dbTest('record faz upsert (incrementa count, atualiza last_seen); recent ordena; prune por idade', async () => {
  const users = createUserRepository();
  const repo = createLoginIpRepository();
  const user = await users.create({ name: `nio-ip-${randomUUID()}`, password: `pw-${randomUUID()}` });
  try {
    await repo.record(user.id, '203.0.113.10');
    await repo.record(user.id, '203.0.113.10'); // mesmo IP → count 2
    await repo.record(user.id, '198.51.100.20');

    const recent = await repo.recent(user.id, 10);
    expect(recent).toHaveLength(2);
    // o último registrado (198.51.100.20) vem primeiro
    expect(recent[0]!.ip).toBe('198.51.100.20');
    const first = recent.find((e) => e.ip === '203.0.113.10')!;
    expect(first.count).toBe(2);

    // envelhece um evento e roda a retenção
    await query(
      `UPDATE login_ip_events SET last_seen = NOW() - INTERVAL '100 days' WHERE user_id = $1 AND ip = '198.51.100.20'`,
      [user.id],
    );
    const pruned = await repo.pruneOlderThan(90);
    expect(pruned).toBe(1);
    expect((await repo.recent(user.id)).map((e) => e.ip)).toEqual(['203.0.113.10']);
  } finally {
    await query('DELETE FROM user_cli WHERE id = $1', [user.id]);
  }
}, 20_000);
