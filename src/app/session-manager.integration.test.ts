/**
 * Integração do `SessionManager` contra o Postgres real — o layer que as tools
 * MCP de ambiente (`nio_session_*`, `nio_env_*`) e a CLI (`nio sessions`,
 * `nio init`) dirigem. Cobre `create` (com materialização real do perfil `dba`
 * via EnvironmentBuilder), `list`, `resolve` por prefixo, `activate` e
 * `materialize`.
 *
 * Gated em `NIO_DATABASE_URL` (sem banco → pula). Usuário descartável.
 */
import { test, expect, afterAll } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { createUserRepository } from '../adapters/pg/user-repository.js';
import { query, closePool } from '../adapters/pg/client.js';
import { SessionManager, SessionNotFoundError } from './session-manager.js';

const hasDb = Boolean(process.env.NIO_DATABASE_URL);
const dbTest = hasDb ? test : test.skip;

afterAll(async () => {
  if (hasDb) await closePool();
});

dbTest(
  'SessionManager: create materializa o dba, list/resolve/activate/materialize sobre o Postgres',
  async () => {
    const users = createUserRepository();
    const manager = new SessionManager();
    const user = await users.create({
      name: `nio-sm-${randomUUID()}`,
      password: `pw-${randomUUID()}`,
    });

    try {
      // create → sessão ativa + config materializado (nio-lang é MCP-base de todo perfil).
      const a = await manager.create({
        userId: user.id,
        name: 'sess-a',
        profile: 'dba',
        projectPath: '/tmp',
        ide: 'other',
      });
      expect(a.materializeError).toBeUndefined();
      expect(a.session.status).toBe('active');
      expect(a.config.mcps).toEqual(expect.arrayContaining(['nio-lang', 'postgres']));
      expect(a.mcps.some((m) => m.id === 'postgres')).toBe(true);

      // create de novo → arquiva a anterior (invariante 1-ativa).
      const b = await manager.create({
        userId: user.id,
        name: 'sess-b',
        profile: 'dba',
        projectPath: '/tmp',
        ide: 'other',
      });

      const list = await manager.list(user.id);
      expect(list.map((s) => s.name).sort()).toEqual(['sess-a', 'sess-b']);
      expect((await manager.findActive(user.id))!.id).toBe(b.session.id);

      // resolve por prefixo + activate volta pra A.
      const resolved = await manager.resolve(user.id, a.session.id.slice(0, 8));
      expect(resolved.id).toBe(a.session.id);
      await manager.activate(user.id, a.session.id.slice(0, 8));
      expect((await manager.findActive(user.id))!.id).toBe(a.session.id);

      // materialize a ativa → reescreve o config, mesmos MCPs.
      const mat = await manager.materialize(user.id);
      expect(mat.session.id).toBe(a.session.id);
      expect(mat.config.mcps).toEqual(expect.arrayContaining(['nio-lang', 'postgres']));

      // pause → sem ativa → materialize sem prefixo lança.
      await manager.setStatus(user.id, a.session.id, 'paused');
      await expect(manager.materialize(user.id)).rejects.toBeInstanceOf(SessionNotFoundError);

      await manager.delete(user.id, a.session.id);
      await manager.delete(user.id, b.session.id);
      expect(await manager.list(user.id)).toHaveLength(0);
    } finally {
      await query('DELETE FROM user_cli WHERE id = $1', [user.id]);
    }
  },
  30_000,
);
