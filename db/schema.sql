
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
-- RAG de DAX: doc/schema vetorizado + cache de consultas (migration 0010)
-- ───────────────────────────────────────────────
-- **Requer pgvector no host** (Debian/PGDG: `postgresql-<ver>-pgvector`). Sem a
-- extensão disponível, este bloco falha aqui — de propósito: melhor quebrar no
-- bootstrap com erro claro do que o RAG falhar misteriosamente depois.
CREATE EXTENSION IF NOT EXISTS vector;

-- Grounding: pedaços de documentação/schema vetorizados.
CREATE TABLE IF NOT EXISTS dax_doc_chunk (
  id            BIGSERIAL PRIMARY KEY,
  repo          TEXT NOT NULL,
  ref           TEXT NOT NULL,
  path          TEXT NOT NULL,
  heading       TEXT,
  content       TEXT NOT NULL,
  content_hash  TEXT NOT NULL,
  embedding     vector(768) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT dax_doc_chunk_unique UNIQUE (repo, ref, path, content_hash)
);
CREATE INDEX IF NOT EXISTS dax_doc_chunk_embedding_idx
  ON dax_doc_chunk USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS dax_doc_chunk_repo_ref_idx ON dax_doc_chunk (repo, ref);

-- Cache semântico: o DAX que funcionou, por pergunta e por modelo semântico.
CREATE TABLE IF NOT EXISTS dax_query_template (
  id             BIGSERIAL PRIMARY KEY,
  request_name   TEXT NOT NULL,
  question_norm  TEXT NOT NULL,
  question_hash  TEXT NOT NULL,
  workspace_id   TEXT NOT NULL,
  dataset_id     TEXT NOT NULL,
  dax            TEXT NOT NULL,
  output_summary JSONB NOT NULL,
  embedding      vector(768) NOT NULL,
  hit_count      INTEGER NOT NULL DEFAULT 0,
  last_ok_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT dax_query_template_hash_unique UNIQUE (question_hash)
);
CREATE INDEX IF NOT EXISTS dax_query_template_embedding_idx
  ON dax_query_template USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS dax_query_template_scope_idx
  ON dax_query_template (workspace_id, dataset_id);

-- Aprendizado contínuo: lições derivadas de erro que depois virou acerto.
--
-- Vale para TODO perfil e TODA tool (não é específico de Fabric). Fica no Postgres
-- compartilhado de propósito: a lição de um colaborador serve o time inteiro — é a
-- vantagem de ser ferramenta de equipe, e não agente pessoal de uma máquina só.
--
-- O par (tool, sintoma_hash) é único: o mesmo erro na mesma tool é UMA lição que
-- acumula acertos, não N linhas repetidas.


CREATE TABLE IF NOT EXISTS agent_lesson (
  id            BIGSERIAL PRIMARY KEY,
  -- Escopo do recall. `tool` é o filtro duro: lição de DAX não vaza pra comando shell.
  tool          TEXT NOT NULL,
  profile       TEXT,
  -- O que se observou, o raciocínio que levou até lá, e o que funcionou depois.
  sintoma       TEXT NOT NULL,
  sintoma_hash  TEXT NOT NULL,
  causa         TEXT,
  solucao       TEXT NOT NULL,
  embedding     vector(768) NOT NULL,
  -- Quantas vezes a lição foi recuperada e quantas o turno seguinte deu certo.
  usos          INTEGER NOT NULL DEFAULT 0,
  acertos       INTEGER NOT NULL DEFAULT 0,
  autor         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ,
  CONSTRAINT agent_lesson_escopo_unique UNIQUE (tool, sintoma_hash)
);

CREATE INDEX IF NOT EXISTS agent_lesson_embedding_idx
  ON agent_lesson USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS agent_lesson_tool_idx ON agent_lesson (tool);

COMMENT ON TABLE agent_lesson IS
  'Lições do aprendizado contínuo: erro observado + raciocínio que causou + solução que funcionou.';
COMMENT ON COLUMN agent_lesson.tool IS
  'Filtro duro do recall — similaridade sozinha não separa lição certa de lição parecida.';
COMMENT ON COLUMN agent_lesson.acertos IS
  'Sobe quando o turno após injetar a lição deu certo. Lição que nunca acerta deve ser podada.';


-- ───────────────────────────────────────────────
-- Comentários documentais
-- ───────────────────────────────────────────────
COMMENT ON TABLE user_cli IS 'Usuários autenticados na NIO-CLI';
COMMENT ON COLUMN user_cli.password IS 'Hash argon2id (PHC string). Hashing e verificação na camada de aplicação; o banco nunca vê a senha em texto puro.';
COMMENT ON TABLE sessions IS 'Sessões de ambiente de desenvolvimento (fonte da verdade)';
COMMENT ON TABLE auth_sessions IS 'Sessões de login (JWT) — separada de sessions (ambiente). Multi-dispositivo: várias linhas ativas por usuário. id é o jti do JWT; revoked_at IS NULL = válida.';
COMMENT ON TABLE dependency_events IS 'Eventos detectados pelo watcher de dependências';
COMMENT ON COLUMN user_cli.phone IS 'Número E.164 pro SMS do 2º fator. NULL = auth_2 desativado.';
COMMENT ON COLUMN user_cli.backup_codes IS 'Hashes argon2id dos 10 códigos de backup (uso único), separados por | ; entrada usada = [USED]. NULL = sem 2FA.';
COMMENT ON TABLE login_challenges IS 'Desafio de OTP em andamento (2º fator). Uso único (consumed_at), TTL curto, 3 tentativas. code_hash = HMAC, nunca o código puro.';
COMMENT ON TABLE login_ip_events IS 'Auditoria: IPs de login por usuário. Só registro, sem enforcement. Retenção 90 d (gateway). Ver ADR 0011.';
COMMENT ON TABLE auth_events IS 'Trilha auditável de auth (append-only). Retenção 180 d (gateway). Ver ADR 0012.';

-- ───────────────────────────────────────────────
-- Tabela: Tasks (execução durável) — migration 0012
-- ───────────────────────────────────────────────
-- Uma request do usuário vira unidade de trabalho persistente, executada pelo
-- `nio-worker`. Checkpoint-and-resume: retoma no primeiro step pendente, não faz
-- replay. `session_id` é PROVENIÊNCIA (ON DELETE SET NULL) — trocar ou apagar a
-- sessão não mata a task; por isso `profile` é snapshot.
CREATE TABLE IF NOT EXISTS tasks (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id    UUID REFERENCES sessions(id) ON DELETE SET NULL,
    user_id       BIGINT NOT NULL REFERENCES user_cli(id) ON DELETE CASCADE,
    profile       TEXT NOT NULL CHECK (profile IN ('fullstack','analyst','scientist','dba','qa','bi')),
    goal          TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','planning','running','waiting_approval','validating','completed','failed','cancelled')),
    current_step  INTEGER,
    max_steps     INTEGER NOT NULL DEFAULT 25 CHECK (max_steps > 0),
    working_set   JSONB NOT NULL DEFAULT '{}',
    engine_session_id TEXT,
    result        TEXT,
    error         TEXT,
    attempts      INTEGER NOT NULL DEFAULT 0,
    locked_by     TEXT,
    locked_at     TIMESTAMPTZ,
    fence         BIGINT NOT NULL DEFAULT 0, -- fencing token do lease
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at  TIMESTAMPTZ,
    -- migration 0013: ALTER TABLE anexa no fim — a ordem aqui espelha isso de propósito
    awaiting_kind    TEXT CHECK (awaiting_kind IN ('approval','question')),
    awaiting_subject TEXT,
    approved_tools   JSONB NOT NULL DEFAULT '[]',
    -- migration 0014: quem executa (agent = worker headless; chat = a TUI)
    kind             TEXT NOT NULL DEFAULT 'agent' CHECK (kind IN ('agent','chat'))
);

CREATE INDEX IF NOT EXISTS tasks_queue_idx ON tasks (user_id, created_at) WHERE status = 'pending' AND kind = 'agent';
CREATE INDEX IF NOT EXISTS tasks_lease_idx ON tasks (locked_at) WHERE status IN ('planning','running','validating');
CREATE INDEX IF NOT EXISTS tasks_user_idx    ON tasks (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tasks_session_idx ON tasks (session_id);

DROP TRIGGER IF EXISTS update_tasks_updated_at ON tasks;
CREATE TRIGGER update_tasks_updated_at
    BEFORE UPDATE ON tasks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trilha da execução. (task_id, step_number, attempt) é único: retry acrescenta
-- linha em vez de sobrescrever — o que falhou na tentativa 1 é o que mais importa.
CREATE TABLE IF NOT EXISTS task_steps (
    id           BIGSERIAL PRIMARY KEY,
    task_id      UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    step_number  INTEGER NOT NULL, -- numeração com folga (10, 20, 30…)
    attempt      INTEGER NOT NULL DEFAULT 1,
    name         TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed','skipped')),
    input        JSONB,
    output       JSONB,
    tool_calls   JSONB,
    tokens_in    INTEGER,
    tokens_out   INTEGER,
    error        TEXT,
    started_at   TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    CONSTRAINT task_steps_unique UNIQUE (task_id, step_number, attempt)
);

CREATE INDEX IF NOT EXISTS task_steps_task_idx ON task_steps (task_id, step_number, attempt);
CREATE INDEX IF NOT EXISTS task_steps_pending_idx ON task_steps (task_id, step_number) WHERE status = 'pending';

COMMENT ON TABLE tasks IS 'Execução durável: request do usuário como unidade de trabalho persistente. Estado sobrevive ao processo.';
COMMENT ON COLUMN tasks.session_id IS 'Proveniência, não escopo: trocar de sessão não pausa a task; apagar a sessão não apaga a task.';
COMMENT ON COLUMN tasks.fence IS 'Fencing token do lease. Toda escrita do worker exige AND fence = $n — worker zumbi não grava.';
COMMENT ON TABLE task_steps IS 'Trilha por step. (task_id, step_number, attempt) é único — retry acrescenta linha, não sobrescreve.';


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
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions, dependency_events TO nio_cli;
GRANT SELECT (id, name, auth_2, phone, ips_using, timestamp_creation, timestamp_password_change, timestamp_last_session, password_pepper_id, backup_pepper_id) ON user_cli TO nio_cli;
GRANT SELECT ON auth_sessions TO nio_cli;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_cli, auth_sessions, login_challenges, auth_events, login_ip_events TO nio_gateway;
GRANT USAGE, SELECT ON SEQUENCE user_cli_id_seq, auth_events_id_seq TO nio_gateway;
GRANT SELECT, INSERT, UPDATE, DELETE ON dax_doc_chunk, dax_query_template TO nio_cli;
GRANT USAGE, SELECT ON SEQUENCE dax_doc_chunk_id_seq, dax_query_template_id_seq TO nio_cli;
GRANT SELECT, INSERT, UPDATE ON agent_lesson TO nio_cli;
GRANT USAGE, SELECT ON SEQUENCE agent_lesson_id_seq TO nio_cli;

-- nio_worker (migration 0012): executa LLM e shell — NADA de user_cli/auth_sessions.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nio_worker') THEN CREATE ROLE nio_worker NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO nio_worker;
GRANT SELECT, INSERT, UPDATE ON tasks, task_steps TO nio_worker;
GRANT USAGE, SELECT ON SEQUENCE task_steps_id_seq TO nio_worker;
GRANT SELECT ON sessions TO nio_worker;
GRANT SELECT, INSERT, UPDATE ON tasks, task_steps TO nio_cli;
GRANT USAGE, SELECT ON SEQUENCE task_steps_id_seq TO nio_cli;
