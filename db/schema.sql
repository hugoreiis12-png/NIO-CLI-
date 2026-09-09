
-- ───────────────────────────────────────────────
-- Tabela: Usuários da CLI
-- ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_cli (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL, -- hash argon2id ($argon2id$v=19$m=...,t=...,p=...$salt$hash) — NUNCA senha em texto puro
    password_pepper_id SMALLINT NOT NULL DEFAULT 0, -- versão do NIO_PEPPERS usada no hash de password; 0 = sem pepper (ADR 0011)
    timestamp_creation TIMESTAMPTZ DEFAULT NOW(),
    timestamp_password_change TIMESTAMPTZ,
    auth_2 BOOLEAN DEFAULT FALSE,        -- 2º fator (SMS OTP) ativo? ver migration 0004
    phone TEXT,                          -- E.164 pro SMS do 2º fator; NULL = auth_2 desativado
    backup_codes TEXT,                   -- 10 hashes argon2id (uso único) juntos por '|'; usado = '[USED]'
    backup_pepper_id SMALLINT NOT NULL DEFAULT 0, -- versão do NIO_PEPPERS usada nos hashes de backup_codes; 0 = sem pepper (ADR 0011)
    timestamp_last_session TIMESTAMPTZ,
    ips_using TEXT DEFAULT '[]' -- JSON array de strings
);

CREATE INDEX idx_user_cli_name ON user_cli(name);
-- token_session removida (migration 0003_drop_token_session.sql) — login é
-- só JWT + auth_sessions agora, ver src/gateway/services/login.ts.

-- ───────────────────────────────────────────────
-- Tabela: Desafios de OTP (2º fator) — migration 0004
-- ───────────────────────────────────────────────
-- Sem Twilio: o estado do OTP é nosso. Uso único, TTL curto, 3 tentativas.
CREATE TABLE IF NOT EXISTS login_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id BIGINT NOT NULL REFERENCES user_cli(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL CHECK (purpose IN ('login', 'enable_2fa')),
    code_hash TEXT NOT NULL,       -- HMAC-SHA256(código, JWT_SECRET). NUNCA o código puro.
    channel TEXT NOT NULL CHECK (channel IN ('whatsapp')),
    attempts INT NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,       -- NULL = ativo; preenchido = já usado
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_login_challenges_user ON login_challenges(user_id);
CREATE INDEX idx_login_challenges_expires ON login_challenges(expires_at);

-- ───────────────────────────────────────────────
-- Tabela: Sessões (estado do ambiente)
-- ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id BIGINT NOT NULL REFERENCES user_cli(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    profile TEXT NOT NULL CHECK (profile IN ('fullstack', 'analyst', 'scientist', 'dba', 'qa', 'bi')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
    project_path TEXT NOT NULL,
    ide TEXT NOT NULL CHECK (ide IN ('terminal', 'vscode', 'cursor', 'other')),
    config JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_sessions_updated ON sessions(updated_at);
CREATE INDEX idx_sessions_config ON sessions USING GIN(config);

-- Trigger para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_sessions_updated_at
    BEFORE UPDATE ON sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ───────────────────────────────────────────────
-- Tabela: Sessões de Autenticação (JWT — login, não ambiente)
-- ───────────────────────────────────────────────
-- Separada de `sessions` (ambiente de desenvolvimento) de propósito: ciclos de
-- vida diferentes (login expira em horas e é revogado no logout; ambiente é
-- de longa duração, pausado/arquivado manualmente) e `sessions` já tem a
-- invariante de 1-ativa-por-usuário, que colide com multi-dispositivo aqui.
CREATE TABLE IF NOT EXISTS auth_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), -- dobra como `jti` embutido no JWT
    user_id BIGINT NOT NULL REFERENCES user_cli(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ, -- NULL = válida; preenchida = revogada (logout)
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX idx_auth_sessions_expires ON auth_sessions(expires_at);

-- ───────────────────────────────────────────────
-- Tabela: Logs de Sessão (metadata)
-- ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS log_session (
    id BIGSERIAL PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, -- (i) amarra o log à sessão (UUID) dona
    id_user_create BIGINT NOT NULL REFERENCES user_cli(id) ON DELETE CASCADE,
    timestamp_creation TIMESTAMPTZ DEFAULT NOW(),
    hash_identification TEXT NOT NULL UNIQUE,
    system_version_os TEXT,
    version_cli TEXT NOT NULL,
    model_context TEXT
);

CREATE INDEX idx_log_session_session ON log_session(session_id);
CREATE INDEX idx_log_session_user ON log_session(id_user_create);
CREATE INDEX idx_log_session_hash ON log_session(hash_identification);

-- ───────────────────────────────────────────────
-- Tabela: Atividades da Sessão
-- ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS session_activity (
    id BIGSERIAL PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, -- (ii) referencia sessions(id) direto (antes: log_session BIGINT)
    mensage_user TEXT,
    context_session JSONB NOT NULL DEFAULT '{}',
    timestamp_creation TIMESTAMPTZ DEFAULT NOW(),
    tools JSONB DEFAULT '[]',
    hash_activity TEXT,
    sequence_logic_number BIGINT
);

CREATE INDEX idx_session_activity_session ON session_activity(session_id);
CREATE INDEX idx_session_activity_hash ON session_activity(hash_activity);
CREATE INDEX idx_session_activity_seq ON session_activity(sequence_logic_number);

-- ───────────────────────────────────────────────
-- Tabela: Eventos de Dependência (watcher)
-- ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dependency_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    dependency_name TEXT NOT NULL,
    dependency_type TEXT NOT NULL CHECK (dependency_type IN ('npm', 'pip', 'cargo', 'gem', 'composer', 'unknown')),
    detected_at TIMESTAMPTZ DEFAULT NOW(),
    installed BOOLEAN DEFAULT FALSE,
    installed_at TIMESTAMPTZ
);

CREATE INDEX idx_dep_events_session ON dependency_events(session_id);
CREATE INDEX idx_dep_events_name ON dependency_events(dependency_name);

-- ───────────────────────────────────────────────
-- Tabela: Auditoria de IP de login (ADR 0011, fase 3)
-- ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS login_ip_events (
    user_id    BIGINT NOT NULL REFERENCES user_cli(id) ON DELETE CASCADE,
    ip         INET   NOT NULL,
    first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    count      BIGINT NOT NULL DEFAULT 1,
    PRIMARY KEY (user_id, ip)
);
CREATE INDEX IF NOT EXISTS idx_login_ip_events_last_seen ON login_ip_events(last_seen);

-- ───────────────────────────────────────────────
-- Tabela: Trilha de auth persistente (ADR 0012)
-- ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS auth_events (
    id       BIGSERIAL PRIMARY KEY,
    at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    event    TEXT   NOT NULL,
    name     TEXT,
    user_id  BIGINT REFERENCES user_cli(id) ON DELETE SET NULL,
    ip       INET,
    trace_id TEXT,
    detail   JSONB
);
CREATE INDEX IF NOT EXISTS idx_auth_events_name ON auth_events(name, at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_events_ip   ON auth_events(ip, at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_events_user ON auth_events(user_id, at DESC);

-- ───────────────────────────────────────────────
-- Comentários documentais
-- ───────────────────────────────────────────────
COMMENT ON TABLE user_cli IS 'Usuários autenticados na NIO-CLI';
COMMENT ON COLUMN user_cli.password IS 'Hash argon2id (PHC string). Hashing e verificação na camada de aplicação; o banco nunca vê a senha em texto puro.';
COMMENT ON TABLE sessions IS 'Sessões de ambiente de desenvolvimento (fonte da verdade)';
COMMENT ON TABLE auth_sessions IS 'Sessões de login (JWT) — separada de sessions (ambiente). Multi-dispositivo: várias linhas ativas por usuário. id é o jti do JWT; revoked_at IS NULL = válida.';
COMMENT ON TABLE log_session IS 'Logs de metadata das sessões ativas';
COMMENT ON COLUMN log_session.session_id IS 'FK para sessions(id) — a sessão dona deste log.';
COMMENT ON TABLE session_activity IS 'Atividades individuais dentro de uma sessão';
COMMENT ON COLUMN session_activity.session_id IS 'FK para sessions(id) — referência direta à sessão (não passa mais por log_session).';
COMMENT ON TABLE dependency_events IS 'Eventos detectados pelo watcher de dependências';
COMMENT ON COLUMN user_cli.phone IS 'Número E.164 pro SMS do 2º fator. NULL = auth_2 desativado.';
COMMENT ON COLUMN user_cli.backup_codes IS 'Hashes argon2id dos 10 códigos de backup (uso único), separados por | ; entrada usada = [USED]. NULL = sem 2FA.';
COMMENT ON TABLE login_challenges IS 'Desafio de OTP em andamento (2º fator). Uso único (consumed_at), TTL curto, 3 tentativas. code_hash = HMAC, nunca o código puro.';
COMMENT ON TABLE login_ip_events IS 'Auditoria: IPs de login por usuário. Só registro, sem enforcement. Retenção 90 d (gateway). Ver ADR 0011.';
COMMENT ON TABLE auth_events IS 'Trilha auditável de auth (append-only). Retenção 180 d (gateway). Ver ADR 0012.';

-- ───────────────────────────────────────────────
-- Least-privilege: roles nio_cli / nio_gateway (migration 0008 · TP-1)
-- ───────────────────────────────────────────────
-- Banco novo de schema.sql: cria os group roles e os grants. O setup dos LOGIN
-- users e a distribuição de NIO_DATABASE_URL / NIO_GATEWAY_DATABASE_URL ficam
-- em docs/security/ops-actions.md. Ver db/migrations/0008_db_roles.sql.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nio_cli') THEN CREATE ROLE nio_cli NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nio_gateway') THEN CREATE ROLE nio_gateway NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO nio_cli, nio_gateway;
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions, dependency_events, log_session, session_activity TO nio_cli;
GRANT USAGE, SELECT ON SEQUENCE log_session_id_seq, session_activity_id_seq TO nio_cli;
GRANT SELECT (id, name, auth_2, phone, ips_using, timestamp_creation, timestamp_password_change, timestamp_last_session, password_pepper_id, backup_pepper_id) ON user_cli TO nio_cli;
GRANT SELECT ON auth_sessions TO nio_cli;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_cli, auth_sessions, login_challenges, auth_events, login_ip_events TO nio_gateway;
GRANT USAGE, SELECT ON SEQUENCE user_cli_id_seq, auth_events_id_seq TO nio_gateway;
