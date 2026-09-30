-- Discrimina quem executa a task.
--
-- A TUI passa a registrar cada turno do chat como task (fatia 1.11), para a
-- trilha, as lições e a política de permissão serem as mesmas do worker. Sem
-- esta coluna isso teria duas consequências ruins:
--
--  1. O `nio-worker` reivindicaria turnos de chat e os RE-EXECUTARIA com o
--     Planner — o usuário veria a própria mensagem virar um plano e rodar de
--     novo sozinha. É o pior defeito possível desta fatia.
--  2. `nio task list` viraria o log de todas as mensagens já digitadas.
--
-- `chat` = executado pela TUI, em processo, com humano na frente (permissão vai
-- ao modal, não estaciona). `agent` = executado pelo `nio-worker`, headless.

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'agent'
    CHECK (kind IN ('agent', 'chat'));

-- O índice da fila é parcial e agora precisa do recorte: sem ele o `claim`
-- varreria também as tasks de chat, que nunca lhe pertencem.
DROP INDEX IF EXISTS tasks_queue_idx;
CREATE INDEX IF NOT EXISTS tasks_queue_idx
  ON tasks (user_id, created_at) WHERE status = 'pending' AND kind = 'agent';

COMMENT ON COLUMN tasks.kind IS
  'Quem executa: agent = nio-worker (headless); chat = a TUI, em processo, com humano na frente.';
