-- Destrava do `waiting_approval`: a task precisa registrar O QUE está esperando.
--
-- Sem isto (estado da migration 0012) o halt de aprovação só ia para o log: o
-- `nio task show` não sabia dizer ao usuário o que liberar, e o `nio task
-- approve` não tinha como conceder permissão para uma tool específica — só
-- daria para liberar tudo, que é exatamente o que a D2 existe para impedir.
--
-- `approved_tools` guarda concessões PONTUAIS, ligadas a esta task: não vazam
-- para outras tasks nem viram regra de perfil. A regra estável mora no código
-- (`ProfileDefinition.autoApprove`), que é revisável em PR — permissão que se
-- acumula em linha de banco é permissão que ninguém audita.

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS awaiting_kind    TEXT
    CHECK (awaiting_kind IN ('approval', 'question')),
  ADD COLUMN IF NOT EXISTS awaiting_subject TEXT,
  ADD COLUMN IF NOT EXISTS approved_tools   JSONB NOT NULL DEFAULT '[]';

COMMENT ON COLUMN tasks.awaiting_kind IS
  'Por que a task estacionou: permissão de tool, ou pergunta do motor. NULL = não está esperando ninguém.';
COMMENT ON COLUMN tasks.awaiting_subject IS
  'Nome da tool ou texto da pergunta que estacionou a task — é o que o `nio task approve` libera.';
COMMENT ON COLUMN tasks.approved_tools IS
  'Concessões pontuais do humano para ESTA task. Nome exato, sem curinga. Não vira regra de perfil.';
