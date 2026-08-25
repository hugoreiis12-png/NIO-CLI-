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

---

## 2026-08-23/24 — Remoção das 16 tools v1, `SessionRepository`, e Gateway JWT (`auth_sessions`)

### Remoção das tools v1 do MCP server
As 16 tools de tarefas/sprints/ponto (`comment_task`, `create_task`, `*_allocation*`,
etc.) foram removidas de `src/tools/index.ts` — só sobram as 4 genéricas de
execução (`nio_delegate_exec`, `nio_exec_status`, `nio_plan`, `nio_validate_plan`).
`src/session-factory.ts` (só suportava backend `supabase`) foi apagado.
`mcp-server.ts` reescrito: autentica lendo `~/.nio/session.json` (mesma fonte
do `nio whoami`) e validando contra `user_cli.token_session` — sem Supabase.
`ToolContext` passou a carregar `UserCli` (v2) em vez de `Gateway`/`User` (v1).

**Ainda no repo, sem uso pelos caminhos ativos**: `src/adapters/supabase/*`,
`src/auth.ts`, `src/database.types.ts`, dependência `@supabase/supabase-js` e
script `gen:types` no `package.json` — resto da `TASK-remocao-v1.md`.

### `SessionRepository` (CRUD de `sessions`, ambiente)
`src/adapters/pg/session-repository.ts` implementa a porta em
`core/repositories.ts`: `create`/`activate` arquivam atomicamente (via
`withTransaction`) as demais sessões `active` do usuário — invariante de
**1 sessão ativa por usuário**. Ainda **sem nenhum comando de CLI ou tool MCP
que o exponha** — só o backend existe.

### Gateway de autenticação — `auth_sessions` (JWT) + `services/login.ts` + `middleware/auth.ts`
Depois de avaliar Kong/Keycloak/Kong AI Gateway (descartados — ver
`docs/v2/ARQUITETURA-GATEWAY.md`) e desenhar o fluxo senha+SMS
(`docs/specs/auth/0003-login-2fa-sms.md`), a primeira peça concreta do
Gateway v2 foi construída: emissão e validação de JWT de sessão, **separado**
de `sessions` (ambiente) de propósito — ver decisão abaixo.

| Arquivo | Papel |
|---|---|
| `db/schema.sql` + `db/migrations/0002_auth_sessions.sql` | Tabela `auth_sessions` — `id` (UUID) dobra como `jti`; `user_id`, `expires_at`, `revoked_at`, `created_at`. Sem invariante de unicidade (multi-dispositivo: várias linhas ativas por usuário) |
| `src/core/session.ts` | Entidade `AuthSession` |
| `src/core/repositories.ts` | Porta `AuthSessionRepository` (`create`, `findById`, `revoke`, `listActiveByUser`, `revokeAllByUser`) |
| `src/adapters/pg/auth-session-repository.ts` (+ teste do mapper) | Implementação Postgres |
| `src/gateway/config.ts` | `getJwtSecret()`, `JWT_EXPIRES_IN` (env vars **sem** prefixo `NIO_` — segredo distribuído pela equipe, igual em toda máquina) |
| `src/gateway/services/login.ts` (+ teste) | `login()`: verifica credencial → cria `auth_session` → assina JWT (`jti = auth_session.id`, HS256). `logout()`: revoga |
| `src/gateway/middleware/auth.ts` (+ teste) | `authenticate()`: valida assinatura+exp do JWT, depois confere `revoked_at`/`expires_at` no Postgres (pega revogação que o JWT sozinho não sabe) |

**Decisão de design (a mais importante desta entrada)**: o desenho original
reaproveitava `sessions.id` como `jti`. Revisado porque `sessions` já carrega
a invariante de 1-ativa-por-usuário (ambiente), que colide direto com
multi-dispositivo no login (logar num 2º aparelho arquivaria a sessão do
1º). `auth_sessions` nasceu como tabela irmã, não filha — relaciona só com
`user_cli`, sem FK pra `sessions`.

**`tsconfig.json`**: `exclude` mudou de `"src/gateway/**"` (pasta inteira,
por causa do `Bun.serve()` do `server.ts` antigo/spec 0002) para
`"src/gateway/server.ts"` (só o arquivo que de fato usa Bun) — o resto da
pasta, incluindo os arquivos novos, é Node-compatível e entra no build normal.

**Dependência nova**: `jsonwebtoken` (+ `@types/jsonwebtoken`).

### Verificação
- `bunx tsc --noEmit` → verde.
- `bun test` → 211/213 (as 2 falhas são dívida pré-existente documentada,
  não relacionada — `cowork-extension.test.ts`/`display_name`).
- Smoke tests manuais (scripts descartáveis, criados e apagados) contra o
  banco de teste local: `AuthSessionRepository` — dois "logins" do mesmo
  usuário coexistem, revogar um não afeta o outro, `revokeAllByUser` limpa
  tudo. Fluxo completo `login()` → `authenticate()` → `logout()` →
  `authenticate()` rejeita com `sessao_revogada` mesmo com assinatura/exp do
  JWT ainda válidos — confirma que a checagem no Postgres está no caminho de
  verdade, não só o JWT sozinho.

### Débito conhecido, não resolvido nesta entrada
- **`login()`/`authenticate()` (JWT) ainda não estão plugados em lugar
  nenhum.** `src/cli/commands/auth.ts` (`nio login`) continua no fluxo
  anterior — `UserRepository.verifyCredentials` direto + `token_session` em
  `user_cli` + `~/.nio/session.json`, sem JWT, sem `auth_sessions`. O Gateway
  novo existe testado e isolado, mas nada da CLI ou do MCP server o chama
  ainda.
- Rota HTTP do Gateway (`nio-gateway`, porta 3000, do desenho em
  `ARQUITETURA-GATEWAY.md`) não foi criada — só a lógica de serviço/middleware.
- Coluna de telefone, conta Twilio Verify, e o resto da spec 0003 (SMS/2FA)
  seguem pendentes.

### Próximo passo
1. Decidir e plugar `services/login.ts`/`middleware/auth.ts` em algum
   consumidor real — `nio login` da CLI, e/ou o `mcp-server.ts` — hoje são
   código morto do ponto de vista de uso (só rodam em teste).
2. Resto da `TASK-remocao-v1.md` (Supabase/`auth.ts`/`database.types.ts`/
   `package.json`).
3. `nio init` — redesenho pendente (hoje ainda vincula a projeto do NOS).

---

## 2026-08-24 — JWT plugado: só um mecanismo de sessão de login agora

Fechado o débito da entrada anterior. `services/login.ts`/`middleware/auth.ts`
deixaram de ser código isolado — agora são o único caminho de login.

### Código alterado
| Arquivo | Mudança |
|---|---|
| `src/gateway/services/login.ts` | `login()` passou a chamar `touchLastSession(user.id)` (comportamento que existia no fluxo antigo, independente do mecanismo de sessão) |
| `src/lib/session-store.ts` (+ teste) | `StoredSession` ganhou `sessionId` (= `jti`, usado no logout pra revogar sem decodificar o token) e `expiresAt`. Sessões locais no formato anterior (sem esses dois campos) passam a ser tratadas como inválidas por `parseStoredSession` — efeito colateral esperado, força um `nio login` novo |
| `src/cli/commands/auth.ts` | `login`/`logout` trocaram `UserRepository.verifyCredentials`+`token_session` por `gateway/services/login.ts` (`login`/`logout`) — `nio login` agora emite e guarda um JWT de verdade |
| `src/mcp-server.ts` | `authenticateSession()` trocou a checagem `user.tokenSession !== stored.token` por `authenticate()` do middleware (valida JWT + `auth_sessions` no Postgres) |

`user_cli.token_session`/`UserRepository.setSessionToken` **não foram
removidos** nesta entrada — ficaram só sem uso (nenhum código escreve mais
neles). Remoção fica pro "Passo 0" da `TASK-remocao-v1.md`, que já foi
atualizado pra refletir isso como próximo passo do segundo agente.

### Verificação
- `bunx tsc --noEmit` → verde.
- `bun test` → 212/214 (mesmas 2 falhas pré-existentes de sempre,
  `cowork-extension.test.ts`).
- Smoke test via CLI real (`expect`, não pipe — `@clack/prompts` exige TTY):
  `register` → `login` → `whoami --json` (confirma `sessionId` batendo com a
  linha em `auth_sessions`, `token_session` em `user_cli` continua `NULL`,
  `timestamp_last_session` setado) → MCP server sobe e loga "autenticado
  como" de verdade → `logout` → `auth_sessions.revoked_at` preenchido →
  `whoami` rejeita → MCP server degrada com aviso claro.

### Próximo passo
1. `docs/v2/TASK-remocao-v1.md`, "Passo 0": remover `token_session`/
   `setSessionToken` (agora seguro — o JWT está validado em produção).
2. Resto da `TASK-remocao-v1.md` (Supabase/`auth.ts`/`database.types.ts`/
   `package.json`/arquivos órfãos de `src/gateway/*` da spec 0002).
3. `nio init` — redesenho pendente (hoje ainda vincula a projeto do NOS).

---

## 2026-08-24 — Túnel HTTP: `nio-gateway` + Edge Filter reais (estágios 2-3-5 da esteira)

Primeira parte do "tunelamento": `nio login`/`logout` deixam de chamar
`gateway/services/login.ts` em processo e passam a falar por HTTP com um
`nio-gateway` de verdade — que já embute o Edge Filter (não é mais só o
Cloudflare Worker vazio de `workers/edge-filter/`, que segue órfão).
Decisão de topologia: **um processo só** (Edge Filter + Gateway core juntos)
— Kong entra na frente depois, como reverse proxy, sem precisar mudar este
código.

### Código adicionado/alterado
| Arquivo | Papel |
|---|---|
| `src/gateway/edge-filter.ts` (+ teste) | Trace id, log estruturado (stderr), parse/validação do corpo — primeira triagem antes de qualquer rota |
| `src/gateway/index.ts` | Entrypoint `nio-gateway` — `http.createServer` nativo, loopback only (`127.0.0.1`), rotas `POST /login`, `POST /logout`, `GET /health` |
| `src/gateway/config.ts` | `GATEWAY_PORT`/`GATEWAY_URL` (`NIO_GATEWAY_PORT`, convenção normal do projeto — diferente de `JWT_SECRET`/`JWT_EXPIRES_IN`, que são sem prefixo de propósito) |
| `src/lib/gateway-client.ts` | Cliente HTTP que a CLI usa pra falar com o gateway — erro claro e acionável se o gateway não estiver no ar |
| `src/cli/commands/auth.ts` | `login`/`logout` trocaram a chamada em processo pelo `gateway-client.ts` |
| `package.json` | `bin.nio-gateway`, `dev:gateway` aponta pro `index.ts` novo (não mais o `server.ts` órfão da spec 0002) |

### Verificação
- `bunx tsc --noEmit` → verde.
- `bun test` → 217/219 (mesmas 2 falhas pré-existentes de sempre).
- Smoke test real: subiu o `nio-gateway` em background, `register` → `login`
  → confirmado no **log do gateway** que a request passou de verdade pelo
  Edge Filter (trace id, `POST /login`) → `whoami --json` → `logout`
  (também logado no gateway) → `auth_sessions.revoked_at` preenchido.
  Testado também o caminho de erro: gateway derrubado → `nio login` dá
  mensagem clara ("Não consegui falar com o nio-gateway... ele está
  rodando?"), não stack trace cru.

### O que ainda não é isto
- Kong (estágio 4 da esteira) — zero deploy, entra na frente deste processo
  depois, sem exigir mudança de código aqui.
- `nio-gateway` precisa estar rodando manualmente (`nio-gateway` numa outra
  janela) — não há auto-start/gerenciamento de processo ainda.
- Edge Filter só loga + valida shape (+ Origin/token, ver abaixo) — sem rate
  limit/ACL (isso é explicitamente trabalho do Kong, não deste código).

### Adendo (mesmo dia) — Edge Filter passa a identificar quem chama

Pergunta levantada: como impedir bot/script forjando request no Edge Filter?
Escopo fechado antes de codar — o gateway é loopback-only (`127.0.0.1`), então
tráfego de rede externa já é bloqueado pelo SO, não pelo app. A ameaça real
é **processo local não-autorizado** (não outro usuário do SO — isso é limite
físico da topologia, sem solução em app). Duas defesas concretas, ambas
implementadas e testadas:

1. **Origin de browser bloqueado** — request com header `Origin` (só browser
   manda) é rejeitada com 403. Mitiga "localhost drive-by" (página maliciosa
   chamando `fetch()` contra a porta local).
2. **Token local compartilhado** (`~/.nio/gateway.token`, chmod 600, gerado
   por quem sobe primeiro — CLI ou gateway — e lido pelo outro) — exigido em
   `/login`/`/logout` (não em `/health`), comparado em tempo constante
   (`timingSafeEqual`). Prova que quem chama conhece a instalação local, não
   é script genérico. Rejeição usa **403**, não 401 — 401 fica exclusivo de
   "credencial errada" no `/login`, senão um token de gateway desatualizado
   pareceria "senha errada" pro usuário.

| Arquivo | Papel |
|---|---|
| `src/lib/gateway-token.ts` (+ teste) | Gera/lê o token compartilhado |
| `src/gateway/edge-filter.ts` | `hasBrowserOrigin`, `extractGatewayToken`, `tokensMatch` (+ testes, 12 casos novos) |
| `src/gateway/index.ts` | Aplica as duas checagens antes de qualquer rota |
| `src/lib/gateway-client.ts` | Manda o token automaticamente em todo request |

Verificação: `tsc` limpo, `bun test` 229/231 (mesmas 2 falhas de sempre).
Smoke real com `curl` simulando ataque: request com `Origin` → 403; request
sem token → 403; `/health` sem token → 200 (passa, como esperado); `nio
login` de verdade → token automático, log do gateway sem `rejected`.

### Próximo passo
1. Kong OSS (DB-less) na frente do `nio-gateway`.
2. Passo 0 da `TASK-remocao-v1.md` (token_session órfão).
3. 2º fator SMS (Twilio) — paralelo, sem dependência dos itens acima.

---

## 2026-08-25 — Kong entra na esteira (estágio 4): rate-limiting real no `/login`

Kong OSS, DB-less, via Docker, na frente do `nio-gateway` — sem mudar
nenhum código de aplicação (é reverse proxy puro, exatamente como
`ARQUITETURA-GATEWAY.md` previu). Fecha o gap identificado na conversa
anterior: brute-force local contra `/login` sem rate limit nenhum.

### Código/infra adicionado
| Arquivo | Papel |
|---|---|
| `kong/kong.yml` | Config declarativa — service `nio-gateway` → `http://host.docker.internal:3000`; rota `/login` com plugin `rate-limiting` (20/min, policy local); `/logout`/`/health` sem rate-limit |
| `kong/docker-compose.yml` | Kong OSS `latest`, portas do host em `127.0.0.1` explícito (não `0.0.0.0` — mesma regra de loopback-only) |
| `src/gateway/config.ts` | `KONG_PROXY_PORT` (default 8000); `GATEWAY_URL` (o que a CLI chama) agora aponta pro Kong, não mais direto pro `nio-gateway` |
| `package.json` | Script `dev:kong` |

### Verificação
- `bunx tsc --noEmit` → verde. `bun test` → 229/231 (mesmas 2 de sempre).
- Smoke real com os dois processos no ar (nio-gateway no host + Kong no
  Docker): `/health` via Kong (8000) devolve o mesmo que direto no
  nio-gateway (3000) — proxy confirmado. `register`→`login` reais pela CLI
  passam pelo Kong (log do nio-gateway sem `rejected`). **Teste de
  rate-limit**: 25 tentativas de `/login` em sequência — as 20 primeiras
  chegam no nio-gateway (rejeitadas por token errado, `403`, de propósito
  pro teste), as 5 seguintes recebem `429` **do próprio Kong**, sem nem
  chegar no nosso código. Headers `RateLimit-Remaining`/`Retry-After`
  confirmados. `/health` seguiu liberado (sem rate-limit), como desenhado.

### O que ainda não é isto
- `jwt`/`acl` do Kong — não configurados ainda; não há rota protegida por
  JWT passando pelo Kong hoje (o MCP server valida em processo, não via
  Kong). Só faz sentido quando existir uma rota assim.
- Kong precisa subir manualmente (`bun run dev:kong` ou
  `docker compose -f kong/docker-compose.yml up`) — sem orquestração
  automática com o `nio-gateway` ainda.

### Próximo passo
1. Passo 0 da `TASK-remocao-v1.md` (token_session órfão).
2. 2º fator SMS (Twilio).
3. Permissionamento por `Profile` (Kong `acl`) — só quando houver rota que
   precise disso de verdade.
