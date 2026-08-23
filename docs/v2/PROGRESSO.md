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

---

## 2026-08-23 — Comandos de auth v2 na CLI (`register`/`login`/`logout`/`whoami`)

### Contexto
Banco remoto (`192.168.0.142`) está numa LAN diferente da máquina de dev —
timeout de rede, não erro de credencial. Decisão: banco de **teste local**
(Postgres via Homebrew, `nio_cli` com `db/schema.sql` aplicado) até a VPN/rede
até o remoto estar disponível; portar depois é só trocar a `NIO_DATABASE_URL`.

Decisão do dono do projeto: a CLI vai usar **100% comandos v2** — o fluxo
PAT→Supabase (`src/auth.ts`) não é mais o caminho de auth exposto, mesmo
ainda existindo no repo (ver `docs/v2/TASK-remocao-v1.md`, tarefa separada
pra desligar o v1 por completo).

### Código adicionado/alterado
| Arquivo | Papel |
|---|---|
| `src/lib/session-store.ts` (+ `.test.ts`) | Sessão local v2: `~/.nio/session.json` (chmod 600), separado do `credentials.json` do v1 |
| `src/cli/commands/auth.ts` (reescrito) | `nio register` (cria em `user_cli` via `UserRepository`), `nio login` (verifica credenciais, gera token, grava `token_session` no banco + sessão local), `nio logout` (limpa os dois), `nio whoami` (lê a sessão local) |
| `src/cli/copy/auth.json`, `src/cli/copy.ts` | Copy de `register`/`login` trocada de PAT pra usuário/senha |
| `src/constants.ts` | `SESSION_FILE = homePath('session.json')` |
| `src/cli/commands/auth.test.ts` | Removido — testava helpers do fluxo PAT que não existem mais; substituído por `src/lib/session-store.test.ts` |

`src/auth.ts` (PAT/Supabase) **não foi tocado** — continua no repo, sem uso
pelo comando `auth` da CLI, candidato a remoção pela tarefa de limpeza v1.

### Verificação
- `bunx tsc --noEmit` → verde.
- `bun test src/lib/session-store.test.ts src/adapters/pg/ src/lib/password.test.ts` → 19/19 passam.
- Smoke test via CLI real (não script solto), driblando o raw-mode do
  `@clack/prompts` com `expect` (precisa de TTY, pipe direto não funciona):
  `register` → `login` → `whoami --json` → `logout` → `whoami` (rejeita, exit 1).
  Confirmado no banco: hash argon2id gravado, `token_session` setado no login
  e limpo no logout, `timestamp_last_session` atualizado.

### Próximo passo
1. Migrar `.env` do banco de teste local pro remoto (`192.168.0.142`) assim
   que a rede/VPN estiver disponível — trocar só `NIO_DATABASE_URL`.
2. Seguir `docs/v2/TASK-remocao-v1.md` pra desligar o v1.
3. `SessionRepository` (CRUD de `sessions`) continua pendente do passo anterior.
