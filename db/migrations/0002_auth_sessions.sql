-- Migration 0002 — cria auth_sessions, separada de sessions (ambiente).
-- Aplicar no banco nio_cli JÁ CRIADO. Só adiciona tabela nova — seguro mesmo
-- com dados existentes em user_cli/sessions, nada é alterado nelas.
--
-- Motivo: sessions.id ia servir de jti do JWT (design revisado) — mas
-- sessions carrega a invariante de 1-sessão-ativa-por-usuário (ambiente de
-- desenvolvimento), que colide com multi-dispositivo no login. auth_sessions
-- é a tabela dedicada a sessão de autenticação, sem essa invariante: cada
-- login cria uma linha própria, independente das demais do usuário.

BEGIN;

CREATE TABLE IF NOT EXISTS auth_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), -- dobra como `jti` embutido no JWT
    user_id BIGINT NOT NULL REFERENCES user_cli(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ, -- NULL = válida; preenchida = revogada (logout)
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at);

COMMENT ON TABLE auth_sessions IS 'Sessões de login (JWT) — separada de sessions (ambiente). Multi-dispositivo: várias linhas ativas por usuário. id é o jti do JWT; revoked_at IS NULL = válida.';

COMMIT;
