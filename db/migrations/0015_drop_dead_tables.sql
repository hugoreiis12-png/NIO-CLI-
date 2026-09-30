-- Remove `log_session` e `session_activity` — schema morto (BACKLOG-TECNICO § 3.1 / § 9.1).
--
-- Zero referência em `src/` confirmada por grep exaustivo em 2026-09-30: nenhum
-- repository, nenhuma query, nenhum import de `SessionLog`/`SessionActivity`
-- (core/types.ts). Duas tabelas, 6 índices e 2 FKs que nunca receberam um
-- INSERT desde que foram criadas — decisão de 3 meses fechada agora: dropar,
-- não implementar. Se a necessidade de auditoria de atividade por sessão
-- voltar, desenha-se de novo com o schema atual em mente, não ressuscita-se
-- este.
--
-- `DROP TABLE` remove os índices e comentários junto — não precisa de DROP
-- separado. Nenhuma outra tabela referencia estas duas (elas referenciam
-- `sessions`, não o contrário), então não há CASCADE a considerar.

DROP TABLE IF EXISTS session_activity;
DROP TABLE IF EXISTS log_session;
