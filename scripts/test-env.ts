/**
 * Preload de `bun test` (§ 11.2 do backlog) — isola a suíte do `.env` real.
 *
 * O Bun carrega `.env` automaticamente ANTES deste preload rodar. Confirmado em
 * 2026-09-30: sem este arquivo, `bun test` herda `NIO_DATABASE_URL` do `.env` do
 * repo — que aponta para o Postgres COMPARTILHADO da equipe (ADR 0014) — e os
 * testes de integração gated só em `Boolean(process.env.NIO_DATABASE_URL)`
 * (ex.: `session-repository.integration.test.ts`) passam a rodar de verdade
 * contra ele: criam e apagam usuários/sessões reais a cada `bun test` local.
 *
 * Por isso o apagamento é INCONDICIONAL por padrão. Quem quiser rodar os
 * testes de integração de propósito precisa do opt-in explícito
 * `NIO_TEST_DB_OK=1` ao lado de `NIO_DATABASE_URL` — sem isso, colar uma URL
 * de outro terminal não bastaria sozinho pra disparar escrita sem querer.
 */
if (process.env.NIO_TEST_DB_OK !== '1') {
  delete process.env.NIO_DATABASE_URL;
}
delete process.env.NIO_DATABASE_SSL_INSECURE;
delete process.env.NIO_DATABASE_CA;
process.env.NIO_METRICS = '0';
