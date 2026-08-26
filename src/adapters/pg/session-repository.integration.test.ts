/**
 * Integração do `SessionRepository` contra o Postgres real — o layer que o
 * comando `nio sessions` dirige (list/activate/pause/delete) e que o `nio init`
 * usa no create. Cobre o ciclo de vida + a invariante **1 sessão ativa por
 * usuário**.
 *
 * Gated em `NIO_DATABASE_URL` (sem banco → pula; o CI DB-free não roda). Cria e
 * apaga um usuário descartável.
 */
import { test, expect, afterAll } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { createUserRepository } from './user-repository.js';
import { createSessionRepository } from './session-repository.js';
import { query, closePool } from './client.js';

const hasDb = Boolean(process.env.NIO_DATABASE_URL);
const dbTest = hasDb ? test : test.skip;

afterAll(async () => {
  if (hasDb) await closePool();
});

dbTest(
  'SessionRepository: ciclo de vida + invariante 1-ativa-por-usuário',
  async () => {
    const users = createUserRepository();
    const repo = createSessionRepository();
    const user = await users.create({
      name: `nio-sess-${randomUUID()}`,
      password: `pw-${randomUUID()}`,
    });

    const mk = (name: string) =>
      repo.create({ userId: user.id, name, profile: 'dba', projectPath: '/tmp', ide: 'other' });

    try {
      // Invariante: criar B arquiva a A (só 1 ativa).
      const a = await mk('sess-a');
      const b = await mk('sess-b');
      expect((await repo.findById(a.id))!.status).toBe('archived');
      expect((await repo.findById(b.id))!.status).toBe('active');

      // list + findActive
      const list = await repo.listByUser(user.id);
      expect(list.map((s) => s.id).sort()).toEqual([a.id, b.id].sort());
      expect((await repo.findActiveByUser(user.id))!.id).toBe(b.id);

      // activate A → A ativa, B arquivada
      await repo.activate(a.id, user.id);
      expect((await repo.findActiveByUser(user.id))!.id).toBe(a.id);
      expect((await repo.findById(b.id))!.status).toBe('archived');

      // pause A → nenhuma ativa
      await repo.setStatus(a.id, 'paused');
      expect(await repo.findActiveByUser(user.id)).toBeNull();

      // updateConfig persiste no JSONB
      await repo.updateConfig(a.id, { languages: ['sql'], mcps: ['postgres'] });
      expect((await repo.findById(a.id))!.config.mcps).toContain('postgres');

      // delete → some da listagem
      await repo.delete(a.id);
      await repo.delete(b.id);
      expect(await repo.listByUser(user.id)).toHaveLength(0);
    } finally {
      await query('DELETE FROM user_cli WHERE id = $1', [user.id]);
    }
  },
  30_000,
);
