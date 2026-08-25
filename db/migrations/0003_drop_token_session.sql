-- 0003 — Remove o mecanismo antigo de sessão de login (`user_cli.token_session`).
--
-- O login agora usa exclusivamente JWT + `auth_sessions` (ver `src/gateway/
-- services/login.ts`, `middleware/auth.ts`). Nenhum código escreve ou lê mais
-- esta coluna (confirmado por grep em 24 ago 2026) — ela ficou órfã quando
-- `cli/commands/auth.ts` e `mcp-server.ts` migraram para o Gateway JWT.
--
-- Reversão (se algum dia precisar recriar):
--   ALTER TABLE user_cli ADD COLUMN token_session TEXT;
--   CREATE INDEX idx_user_cli_token ON user_cli(token_session);

DROP INDEX IF EXISTS idx_user_cli_token;
ALTER TABLE user_cli DROP COLUMN IF EXISTS token_session;
