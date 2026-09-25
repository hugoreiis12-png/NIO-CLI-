-- Aprendizado contínuo: lições derivadas de erro que depois virou acerto.
--
-- Vale para TODO perfil e TODA tool (não é específico de Fabric). Fica no Postgres
-- compartilhado de propósito: a lição de um colaborador serve o time inteiro — é a
-- vantagem de ser ferramenta de equipe, e não agente pessoal de uma máquina só.
--
-- O par (tool, sintoma_hash) é único: o mesmo erro na mesma tool é UMA lição que
-- acumula acertos, não N linhas repetidas.

CREATE EXTENSION IF NOT EXISTS vector;

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

GRANT SELECT, INSERT, UPDATE ON agent_lesson TO nio_cli;
GRANT USAGE, SELECT ON SEQUENCE agent_lesson_id_seq TO nio_cli;
