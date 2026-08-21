# NIO-CLI v2 — Log de progresso

> Registro cronológico das mudanças da migração v1 (cliente NOS) → v2
> (orquestrador de ambientes). Fonte de escopo: `NIO-CLI-Transicao-v1-v2.md`.
> Convenção: cada bloco datado, com o que mudou, por quê e como verificar.

---

## 2026-08-21 — Fundação da conexão + primeiro repositório

### Decisões travadas
- **Driver de banco:** `pg` + `@types/pg` (Node-first). Descartado `Bun.sql`.
- **Conexão:** só via env `NIO_DATABASE_URL` (`postgres://user:pass@host:5432/nio_cli`);
  TLS opcional via `NIO_DATABASE_SSL=true`. Nunca destino default silencioso.
- **Senhas:** hash **argon2id** (`@node-rs/argon2`, params OWASP: 19 MiB / t=2 / p=1).
  `user_cli.password` guarda a PHC string; texto puro nunca persiste nem é logado.
- **`CLAUDE.md` refatorado** para a arquitetura v2 (removida regra `Bun.sql`/"don't
  use pg" e a seção do Fluxo NOS).

### Modelagem do banco (schema.sql)
Buraco de identidade de sessão resolvido — `sessions` (UUID) vira o hub:
- **(i)** `log_session` ganhou `session_id UUID → sessions(id)` (`ON DELETE CASCADE`).
- **(ii)** `session_activity` trocou `id_session BIGINT→log_session` por
  `session_id UUID → sessions(id)`.
- `user_cli.password` documentado como argon2id (comentário + `COMMENT ON COLUMN`).
- Schema versionado no repo em `db/schema.sql`; delta aplicável ao banco vivo em
  `db/migrations/0001_session_fk_argon2.sql`.

Relacionamentos (todos `ON DELETE CASCADE`):
`user_cli 1─N sessions` · `sessions 1─N {log_session, session_activity, dependency_events}`
· `user_cli 1─N log_session` (via `id_user_create`).

### Código adicionado
| Arquivo | Papel |
|---|---|
| `src/adapters/pg/client.ts` | Pool singleton lazy: `getPool`, `query`, `withTransaction`, `ping`, `closePool` |
| `src/adapters/pg/client.test.ts` | 4 testes (validação de env + singleton), DB-free |
| `scripts/db-ping.ts` + script `db:ping` | Healthcheck manual (`SELECT 1`) |
| `src/lib/password.ts` | `hashPassword` / `verifyPassword` (argon2id) |
| `src/lib/password.test.ts` | 5 testes de roundtrip argon2id |
| `src/core/session.ts` | Domínio v2: entidades das 5 tabelas + enums dos `CHECK` |
| `src/core/repositories.ts` | Port `UserRepository` (+ `NewUserInput`) |
| `src/adapters/pg/user-repository.ts` | Implementação pg do `UserRepository` (+ `mapUserRow`) |
| `src/adapters/pg/user-repository.test.ts` | 5 testes de `mapUserRow`, DB-free |

Deps novas: `pg@8.23.0`, `@types/pg`, `@node-rs/argon2@2.1.0`.

### Verificação
- `bunx tsc --noEmit` → **verde (exit 0)**.
- Novos testes v2: **14/14 passam** (`bun test src/adapters/pg/ src/lib/password.test.ts`).
- Healthcheck do banco vivo (`bun run db:ping`): **pendente** — precisa do
  `NIO_DATABASE_URL` real apontando pro `nio_cli`.

### Débito pré-existente (não introduzido aqui, legado v1 → Sprint 0)
- `src/lib/cowork-extension.test.ts` "metadados fixos do manifest": stale após a
  edição externa do `brand.ts` (`productName` NOS→NIO, `company` removido).
  Fix mínimo aplicado no fonte (`brand.company` → `brand.productName`) só para
  destravar o `tsc`; o teste segue vermelho e o módulo (Cowork/NOS) sai no Sprint 0.
- `dependencies.test.ts` e `provision.test.ts`: falham por `symlink EPERM`
  (privilégio do Windows) — ambiental, sem relação com v2.

### Próximo passo
1. Rodar `NIO_DATABASE_URL=... bun run db:ping` contra o `nio_cli` vivo.
2. Aplicar `db/migrations/0001_*.sql` no banco.
3. Modelar `SessionRepository` (CRUD de sessões) sobre o mesmo Pool.
