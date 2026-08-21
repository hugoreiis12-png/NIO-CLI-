# 0001 — Backend PostgreSQL dual-IP (investigação read-only + store de users read-write)

- **Status:** em progresso (port + config + guarda entregues; adapter vivo pendente de credencial)
- **Fase/IDs do roadmap:** F12 (adapter dual-destino), F12-T3 (guarda read-only), P01 (dois IPs)
- **Decisão do produto (Hugo, 2026-07-27):** promover o PostgreSQL como backend,
  mantendo a arquitetura hexagonal já existente. O Supabase sai do caminho
  crítico; a identidade/controle de usuários passa a uma tabela de cadastro no
  próprio Postgres.

## Contexto

O direcionamento do roadmap é "NIO read-only sobre o PostgreSQL + análise
profunda". Sobre isso, duas decisões novas:

1. **Dois bancos (dual-IP), porta 5432 em ambos:**
   - `primary` = **192.168.0.142** (banco novo)
   - `secondary` = **192.168.0.250** (banco antigo)
2. **Split read-only / read-write:** todo o banco é **read-only**, exceto o
   **store de cadastro de usuários (`users`)**, que é **read-write** — o único
   caminho de escrita do backend Postgres, para "controle melhor" de usuários.

Isso revisa parcialmente o Invariante #1 do roadmap ("adapter PostgreSQL é
read-only, sem DML"): o invariante continua valendo para os **alvos de
investigação** (primary/secondary), mas **não** para o store de users, que é um
recurso próprio do NIO, gravável e isolado.

## Arquitetura

A `Gateway` de domínio (`core/ports.ts`) é neutra de backend, então nada disso
toca as 20 tools. Introduzimos um port novo, separado:

```
core/ports.ts
  ├── Gateway              (domínio: tasks/allocations — INALTERADO)
  └── InvestigationGateway (NOVO: query read-only por destino explícito)

adapters/postgres/
  ├── targets.ts     mapa host→destino + resolução de DSN por env (throw se ausente)
  ├── read-only.ts   guarda de DQL antes da rede (assertReadOnlyQuery)
  ├── client.ts      [pendente] Bun.sql lazy por destino + sessão READ ONLY
  └── gateway.ts     [pendente] implementa InvestigationGateway
```

### Configuração (env — credencial nunca no repo, regra P0-T2)

| Env var | Papel | Modo |
| --- | --- | --- |
| `NIO_DB_PRIMARY_URL` | DSN do banco novo (142) | read-only |
| `NIO_DB_SECONDARY_URL` | DSN do banco antigo (250) | read-only |
| `NIO_DB_USERS_URL` | DSN do store de cadastro de users | read-write |

Host/porta ficam no código (`DB_TARGETS`, referência estável, não são segredo);
usuário/senha/database vêm sempre da env. Destino **sempre explícito** — se a
env do destino pedido não existe, erro claro, nunca um default silencioso
(Invariante #4).

### Guarda de read-only (três camadas, F12-T3 + F15)

1. **Código** (`assertReadOnlyQuery`): allowlist do verbo inicial
   (SELECT/WITH/TABLE/VALUES) + proibição de múltiplas instruções. Barra o
   óbvio antes de gastar rede. **Não é autoritativo** (um `WITH … DELETE`
   começa com WITH).
2. **Sessão do banco** [pendente no `client.ts`]: cada query de investigação
   roda com a sessão aberta como `READ ONLY`.
3. **Role DQL-only do Postgres** [infra, P0-T2/F15]: a role de conexão dos
   alvos de investigação não tem DML/DDL — camada autoritativa.

O store de users (`NIO_DB_USERS_URL`) **não** passa pela guarda #1/#2: é o
caminho de escrita legítimo.

## Entregue nesta rodada

- `core/types.ts`: `DbTarget`, `QueryResult`.
- `core/ports.ts`: `InvestigationGateway` (F12-T1 — desenho do port, sem impl).
- `adapters/postgres/targets.ts` + `read-only.ts` (+ testes, 11 verdes).

## Pendente (destrava com a credencial)

- **De você:** DSN completo (user/senha/dbname) de cada destino + schema da
  tabela `users` e o modelo de autenticação que substitui o PAT→JWT do Supabase.
- **F12-T2:** `client.ts` (Bun.sql lazy por destino, sessão READ ONLY) +
  `gateway.ts` implementando `InvestigationGateway`, testado contra Postgres
  local/fixture.
- **Identidade:** port de users (read-write) + fluxo de login contra Postgres,
  desacoplando de `auth.ts`/`token-exchange` do Supabase.
- **F15:** teste de integração confirmando que a role rejeita `INSERT` nos
  alvos read-only.
