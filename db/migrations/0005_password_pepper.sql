 -- 0005 — Pepper de senha / códigos de backup (ADR 0011, fase 1).
--
-- Adiciona a versão do pepper (`NIO_PEPPERS`) usada em cada hash. 0 = legado /
-- sem pepper. O re-hash on login (`verifyCredentials`) migra 0 → id atual de
-- forma transparente; os códigos de backup migram quando forem regenerados.
--
-- Reversão (se preciso):
--   ALTER TABLE user_cli DROP COLUMN IF EXISTS password_pepper_id;
--   ALTER TABLE user_cli DROP COLUMN IF EXISTS backup_pepper_id;

ALTER TABLE user_cli
    ADD COLUMN IF NOT EXISTS password_pepper_id SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS backup_pepper_id   SMALLINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN user_cli.password_pepper_id IS
    'Versão do NIO_PEPPERS usada no hash de password. 0 = sem pepper. Ver ADR 0011.';
COMMENT ON COLUMN user_cli.backup_pepper_id IS
    'Versão do NIO_PEPPERS usada nos hashes de backup_codes. 0 = sem pepper. Ver ADR 0011.';
