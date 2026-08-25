/**
 * Suíte de integração da FATIA 1 do EnvironmentBuilder — valida o `nio init` no
 * AMBIENTE REAL: executa o pipeline que roda depois dos prompts interativos
 * (criar `Session` → `EnvironmentBuilder.build` → `updateConfig` no Postgres →
 * `installOpencodeGlobal` gravando o `opencode.json`) e confere os dois lados.
 *
 * Os prompts (@clack, exigem TTY) ficam de fora — não são a materialização, só
 * coletam profile/nome/ide. O que esta suíte prova é a fatia 1 de fato: o perfil
 * escolhido vira `sessions.config` no banco + MCPs no `opencode.json`.
 *
 * Precisa de `NIO_DATABASE_URL` (Postgres vivo) — sem ela, os casos são pulados
 * (não quebram CI DB-free). Cria e apaga um usuário descartável; escreve num
 * `opencode.json` temporário (seam de path), nunca no do usuário.
 */
import { test, expect, afterAll } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUserRepository } from '../../../adapters/pg/user-repository.js';
import { createSessionRepository } from '../../../adapters/pg/session-repository.js';
import { query, closePool } from '../../../adapters/pg/client.js';
import { EnvironmentBuilder } from '../../../app/environment-builder.js';
import { installOpencodeGlobal, NIO_OPERATOR_MODEL } from '../../../lib/client-configs.js';

const hasDb = Boolean(process.env.NIO_DATABASE_URL);
const dbTest = hasDb ? test : test.skip;

afterAll(async () => {
  if (hasDb) await closePool();
});

dbTest(
  'nio init (fatia 1) — perfil dba materializa sessions.config no Postgres + MCPs no opencode.json',
  async () => {
    const users = createUserRepository();
    const sessions = createSessionRepository();
    const dir = mkdtempSync(join(tmpdir(), 'nio-init-e2e-'));
    const opencodePath = join(dir, 'opencode.json');

    const user = await users.create({
      name: `nio-e2e-${randomUUID()}`,
      password: `pw-${randomUUID()}`,
    });

    let sessionId: string | undefined;
    try {
      // ── pipeline do `nio init` (o que roda após os prompts), perfil dba ──
      const session = await sessions.create({
        userId: user.id,
        name: 'e2e-fatia1',
        profile: 'dba',
        projectPath: dir,
        ide: 'other',
      });
      sessionId = session.id;

      const env = await new EnvironmentBuilder().build('dba');
      await sessions.updateConfig(session.id, env.config);
      const install = installOpencodeGlobal(env.mcps, opencodePath);

      // ── lado Postgres: round-trip real do sessions.config ──
      const persisted = await sessions.findById(session.id);
      expect(persisted).not.toBeNull();
      expect(persisted!.profile).toBe('dba');
      expect(persisted!.config.mcps).toContain('postgres');
      expect(persisted!.config.languages).toContain('sql');

      // ── lado opencode.json: arquivo real escrito ──
      expect(install.status).toBe('created');
      const oc = JSON.parse(readFileSync(opencodePath, 'utf-8')) as {
        model: string;
        mcp: Record<string, { command: string[] }>;
      };
      expect(oc.model).toBe(NIO_OPERATOR_MODEL);
      expect(oc.mcp.nio).toBeDefined();
      expect(oc.mcp['nio-lang']).toBeDefined(); // MCP-base (server nativo de linguagens)
      const pgSpec = env.mcps.find((m) => m.id === 'postgres')!;
      expect(oc.mcp.postgres.command).toEqual(pgSpec.command);
    } finally {
      // Limpeza: sessão (CASCADE cobre logs/atividades) + usuário descartável + tmp.
      if (sessionId) await sessions.delete(sessionId);
      await query('DELETE FROM user_cli WHERE id = $1', [user.id]);
      rmSync(dir, { recursive: true, force: true });
    }
  },
  30_000,
);
