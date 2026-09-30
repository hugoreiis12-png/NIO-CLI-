-- Execução durável: uma request do usuário vira uma `task` com trilha de `steps`
-- persistida, executada pelo `nio-worker` — não pela sessão HTTP nem pela TUI.
--
-- A promessa é "o cliente pode fechar e a task continua". Isso exige que NENHUM
-- estado crítico viva só na RAM do processo: cada transição de step é um UPDATE
-- aqui. O modelo é checkpoint-and-resume (retoma no primeiro step pendente), não
-- replay determinístico — LLM não é determinístico e `bash` tem efeito colateral.
-- Consequência: um step pode rodar duas vezes, logo efeito externo é idempotente.
--
-- `tasks.session_id` é PROVENIÊNCIA, não escopo de execução: trocar a sessão ativa
-- não pausa a task, e apagar a sessão não apaga o trabalho (ON DELETE SET NULL).
-- Por isso `profile` é snapshot — a task não depende da sessão estar viva.

CREATE TABLE IF NOT EXISTS tasks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- proveniência; NULL = a sessão de origem foi apagada, a task sobrevive
  session_id    UUID REFERENCES sessions(id) ON DELETE SET NULL,
  user_id       BIGINT NOT NULL REFERENCES user_cli(id) ON DELETE CASCADE,
  -- snapshot: o perfil da sessão pode mudar; a task foi planejada sob ESTE
  profile       TEXT NOT NULL CHECK (profile IN
                  ('fullstack','analyst','scientist','dba','qa','bi')),
  goal          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN
                  ('pending','planning','running','waiting_approval',
                   'validating','completed','failed','cancelled')),
  current_step  INTEGER,
  -- teto anti-loop: um Validator que responde INCOMPLETE para sempre queimaria o backend
  max_steps     INTEGER NOT NULL DEFAULT 25 CHECK (max_steps > 0),
  -- short-term memory do turno (F2). Em F1 fica '{}'. Resultado grande vai pro
  -- task_steps.output; aqui só resumo e ponteiro, senão o JSONB cresce a cada step.
  working_set   JSONB NOT NULL DEFAULT '{}',
  -- sessão do opencode, para re-attach depois de um restart do worker
  engine_session_id TEXT,
  result        TEXT,
  error         TEXT,
  attempts      INTEGER NOT NULL DEFAULT 0,
  -- ── lease da fila ──
  locked_by     TEXT,
  locked_at     TIMESTAMPTZ,
  -- fencing token: sobe a cada claim. Worker zumbi grava com fence velho e não casa.
  fence         BIGINT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ
);

-- Fila: índice PARCIAL, só as linhas reivindicáveis entram (barato mesmo com histórico grande).
CREATE INDEX IF NOT EXISTS tasks_queue_idx
  ON tasks (user_id, created_at) WHERE status = 'pending';
-- Varredura de lease vencida — sem ela um worker morto trava a task para sempre.
CREATE INDEX IF NOT EXISTS tasks_lease_idx
  ON tasks (locked_at) WHERE status IN ('planning','running','validating');
CREATE INDEX IF NOT EXISTS tasks_user_idx    ON tasks (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tasks_session_idx ON tasks (session_id);

-- Reusa a função que o schema já define para `sessions`.
DROP TRIGGER IF EXISTS update_tasks_updated_at ON tasks;
CREATE TRIGGER update_tasks_updated_at
  BEFORE UPDATE ON tasks FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trilha da execução. Uma linha por (step, tentativa): retry NÃO sobrescreve,
-- porque o que falhou na tentativa 1 é a informação mais valiosa da trilha.
CREATE TABLE IF NOT EXISTS task_steps (
  id           BIGSERIAL PRIMARY KEY,
  task_id      UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  -- numeração com folga (10, 20, 30…) para inserir no meio sem renumerar
  step_number  INTEGER NOT NULL,
  attempt      INTEGER NOT NULL DEFAULT 1,
  name         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN
                 ('pending','running','done','failed','skipped')),
  input        JSONB,
  output       JSONB,
  -- trilha das tools chamadas no step (nome + status), não o payload inteiro
  tool_calls   JSONB,
  tokens_in    INTEGER,
  tokens_out   INTEGER,
  error        TEXT,
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  CONSTRAINT task_steps_unique UNIQUE (task_id, step_number, attempt)
);

CREATE INDEX IF NOT EXISTS task_steps_task_idx ON task_steps (task_id, step_number, attempt);
-- Busca do próximo step a executar (o caminho quente do worker).
CREATE INDEX IF NOT EXISTS task_steps_pending_idx
  ON task_steps (task_id, step_number) WHERE status = 'pending';

COMMENT ON TABLE tasks IS
  'Execução durável: request do usuário como unidade de trabalho persistente. Estado sobrevive ao processo.';
COMMENT ON COLUMN tasks.session_id IS
  'Proveniência, não escopo: trocar de sessão não pausa a task; apagar a sessão não apaga a task.';
COMMENT ON COLUMN tasks.fence IS
  'Fencing token do lease. Toda escrita do worker exige AND fence = $n — worker zumbi não grava.';
COMMENT ON COLUMN tasks.working_set IS
  'Short-term memory (F2). Teto ~8 KB: resultado grande vai em task_steps.output, aqui só o resumo.';
COMMENT ON TABLE task_steps IS
  'Trilha por step. (task_id, step_number, attempt) é único — retry acrescenta linha, não sobrescreve.';

-- ── Least-privilege (segue a 0008 · TP-1) ────────────────────────────────────
-- `nio_worker` executa LLM e shell por minutos: NÃO recebe nada de user_cli nem
-- auth_sessions. Um step hostil não alcança credencial.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nio_worker') THEN
    CREATE ROLE nio_worker NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO nio_worker;
GRANT SELECT, INSERT, UPDATE ON tasks, task_steps TO nio_worker;
GRANT USAGE, SELECT ON SEQUENCE task_steps_id_seq TO nio_worker;
-- o worker precisa ler a sessão de origem para montar o contexto do step
GRANT SELECT ON sessions TO nio_worker;

-- CLI/MCP cria, lista e cancela; não executa.
GRANT SELECT, INSERT, UPDATE ON tasks, task_steps TO nio_cli;
GRANT USAGE, SELECT ON SEQUENCE task_steps_id_seq TO nio_cli;
