-- Migration 0001 — amarra log_session/session_activity a sessions(id) + doc argon2id
-- Aplicar no banco nio_cli JÁ CRIADO. Seguro em tabelas vazias (greenfield).
-- Se log_session / session_activity já tiverem linhas, popular session_id antes de
-- promover a NOT NULL (ver blocos comentados no fim).

BEGIN;

-- (i) log_session passa a apontar para a sessão (UUID) dona
ALTER TABLE log_session
    ADD COLUMN IF NOT EXISTS session_id UUID;

ALTER TABLE log_session
    ADD CONSTRAINT log_session_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;

ALTER TABLE log_session
    ALTER COLUMN session_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_log_session_session ON log_session(session_id);

-- (ii) session_activity referencia sessions(id) direto (antes: id_session BIGINT -> log_session)
DROP INDEX IF EXISTS idx_session_activity_session;

ALTER TABLE session_activity
    DROP COLUMN IF EXISTS id_session;

ALTER TABLE session_activity
    ADD COLUMN session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE;

CREATE INDEX idx_session_activity_session ON session_activity(session_id);

-- Documentação (argon2id + FKs)
COMMENT ON COLUMN user_cli.password IS 'Hash argon2id (PHC string). Hashing e verificação na camada de aplicação; o banco nunca vê a senha em texto puro.';
COMMENT ON COLUMN log_session.session_id IS 'FK para sessions(id) — a sessão dona deste log.';
COMMENT ON COLUMN session_activity.session_id IS 'FK para sessions(id) — referência direta à sessão (não passa mais por log_session).';

COMMIT;

-- Se houver dados legados e for preciso backfill antes do SET NOT NULL:
--   UPDATE log_session l SET session_id = <mapa> WHERE session_id IS NULL;
--   -- session_activity: sem coluna de origem confiável (id_session apontava p/ log_session);
--   -- em greenfield basta truncar: TRUNCATE session_activity;
