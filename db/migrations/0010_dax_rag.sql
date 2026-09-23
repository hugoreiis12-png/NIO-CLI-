-- 0010 — RAG vetorial para consultas DAX no Fabric (pgvector).
-- ───────────────────────────────────────────────────────────────
-- Duas tabelas, dois papéis distintos:
--
--   dax_doc_chunk      → grounding. Pedaços da documentação oficial (repos
--                        MicrosoftDocs vendorizados por zipball, pinados por SHA).
--                        Alimenta o contexto de geração do DAX.
--
--   dax_query_template → cache semântico. O "template simplificado": nome da
--                        request + o DAX que retornou com sucesso + um resumo da
--                        saída. NÃO guarda a request nem o resultado inteiros.
--                        Uma pergunta parecida reusa o DAX já validado.
--
-- Embeddings: 768 dimensões (multilingual-e5-base, gerado localmente).
-- Trocar de modelo muda a dimensão → exige nova migration + reingestão.
--
-- Índice: HNSW (pgvector >= 0.5.0). Se o servidor tiver pgvector mais antigo,
-- troque por:  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
--
-- Roda como OWNER do schema (o `CREATE EXTENSION` exige privilégio).
--
-- Reversão:
--   DROP TABLE IF EXISTS dax_query_template, dax_doc_chunk;
--   -- a extensão fica (outros objetos podem usá-la): DROP EXTENSION vector;

CREATE EXTENSION IF NOT EXISTS vector;

-- ── grounding: documentação vendorizada ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS dax_doc_chunk (
  id            BIGSERIAL PRIMARY KEY,
  repo          TEXT NOT NULL,              -- ex.: MicrosoftDocs/dax-docs
  ref           TEXT NOT NULL,              -- commit SHA pinado (imutável)
  path          TEXT NOT NULL,              -- caminho do .md dentro do repo
  heading       TEXT,                       -- seção de origem do chunk
  content       TEXT NOT NULL,
  content_hash  TEXT NOT NULL,              -- sha256 do content (reingestão idempotente)
  embedding     vector(768) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT dax_doc_chunk_unique UNIQUE (repo, ref, path, content_hash)
);

CREATE INDEX IF NOT EXISTS dax_doc_chunk_embedding_idx
  ON dax_doc_chunk USING hnsw (embedding vector_cosine_ops);

-- reingestão de um ref novo apaga o antigo por repo → lookup por (repo, ref)
CREATE INDEX IF NOT EXISTS dax_doc_chunk_repo_ref_idx ON dax_doc_chunk (repo, ref);

-- ── cache semântico: templates de consultas que funcionaram ──────────────────

CREATE TABLE IF NOT EXISTS dax_query_template (
  id             BIGSERIAL PRIMARY KEY,
  request_name   TEXT NOT NULL,             -- nome curto da request
  question_norm  TEXT NOT NULL,             -- pergunta normalizada (lower/trim/espaços)
  question_hash  TEXT NOT NULL,             -- sha256 do question_norm + escopo → hit exato
  workspace_id   TEXT NOT NULL,             -- escopo: um DAX só vale no modelo em que nasceu
  dataset_id     TEXT NOT NULL,
  dax            TEXT NOT NULL,             -- a query que retornou com sucesso
  output_summary JSONB NOT NULL,            -- row_count + colunas + amostra curta
  embedding      vector(768) NOT NULL,
  hit_count      INTEGER NOT NULL DEFAULT 0,
  last_ok_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT dax_query_template_hash_unique UNIQUE (question_hash)
);

CREATE INDEX IF NOT EXISTS dax_query_template_embedding_idx
  ON dax_query_template USING hnsw (embedding vector_cosine_ops);

-- a busca por similaridade é sempre filtrada pelo modelo semântico
CREATE INDEX IF NOT EXISTS dax_query_template_scope_idx
  ON dax_query_template (workspace_id, dataset_id);

-- ── grants: domínio "ambiente" do CLI/MCP (mesma regra da 0008) ──────────────

GRANT SELECT, INSERT, UPDATE, DELETE
  ON dax_doc_chunk, dax_query_template
  TO nio_cli;

GRANT USAGE, SELECT
  ON SEQUENCE dax_doc_chunk_id_seq, dax_query_template_id_seq
  TO nio_cli;
