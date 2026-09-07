-- 0008 — Least-privilege: dois roles de banco (auditoria TP-1).
--
-- Hoje o CLI, o MCP server e o gateway usam a MESMA connection string, com
-- escrita total. Qualquer usuário do CLI pode `UPDATE user_cli SET password`,
-- ler os hashes, apagar `auth_events`, etc. — furando toda a auth do gateway.
--
-- Este migration cria GROUP ROLES (NOLOGIN) com os grants certos. O SETUP
-- (fora do migration, sem segredo) cria os LOGIN users e os põe nos grupos:
--
--   CREATE ROLE nio_cli_user   LOGIN PASSWORD '...';  GRANT nio_cli     TO nio_cli_user;
--   CREATE ROLE nio_gw_user    LOGIN PASSWORD '...';  GRANT nio_gateway TO nio_gw_user;
--
-- Daí:  NIO_DATABASE_URL          → nio_cli_user   (CLI + MCP)
--       NIO_GATEWAY_DATABASE_URL  → nio_gw_user    (gateway)
--
-- Rodar migrations/`bun run db:migrate` segue sendo tarefa do OWNER do schema.
--
-- Reversão:
--   REVOKE ALL ON ALL TABLES IN SCHEMA public FROM nio_cli, nio_gateway;
--   DROP ROLE IF EXISTS nio_cli; DROP ROLE IF EXISTS nio_gateway;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nio_cli') THEN
    CREATE ROLE nio_cli NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nio_gateway') THEN
    CREATE ROLE nio_gateway NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO nio_cli, nio_gateway;

-- ── nio_cli : domínio "ambiente" + identidade (leitura, SEM os hashes) ────────

GRANT SELECT, INSERT, UPDATE, DELETE
  ON sessions, dependency_events, log_session, session_activity
  TO nio_cli;
GRANT USAGE, SELECT
  ON SEQUENCE log_session_id_seq, session_activity_id_seq
  TO nio_cli;

-- identidade: só as colunas que `mapUserRow` usa — NUNCA `password`/`backup_codes`
GRANT SELECT (
  id, name, auth_2, phone, ips_using,
  timestamp_creation, timestamp_password_change, timestamp_last_session,
  password_pepper_id, backup_pepper_id
) ON user_cli TO nio_cli;

-- validar o próprio JWT vs revogação (MCP server)
GRANT SELECT ON auth_sessions TO nio_cli;

-- ── nio_gateway : tabelas de auth (escrita total) ────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE
  ON user_cli, auth_sessions, login_challenges, auth_events, login_ip_events
  TO nio_gateway;
GRANT USAGE, SELECT
  ON SEQUENCE user_cli_id_seq, auth_events_id_seq
  TO nio_gateway;
