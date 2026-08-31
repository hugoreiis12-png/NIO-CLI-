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
| `src/core/types.ts` | Domínio v2: entidades das 5 tabelas + enums dos `CHECK` |
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
| `src/core/types.ts` | Entidade `AuthSession` |
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

---

## 2026-08-25 — Auditoria do 2º agente (TASK-remocao-v1.md) + Passo 0 fechado

Dono do projeto pediu pra checar o progresso do segundo agente (opencode) na
limpeza do v1 e ajudar se estivesse devagar/com muita task. Achado: só o
Passo 0 tinha sido tocado, e faltava um pedaço (schema.sql desatualizado).
Resto do checklist não tinha começado. Fechei o Passo 0 e corrigi a
`TASK-remocao-v1.md`, que tinha a ordem de dependência **invertida**.

### Passo 0 — fechado
`db/schema.sql` não tinha sido atualizado (só o código + a migration
existiam, ambos corretos). Adicionei a remoção da coluna `token_session`/
índice no schema.sql, apliquei a migration `0003_drop_token_session.sql` no
banco de teste local, confirmei `\d user_cli` sem a coluna e todas as FKs
(`auth_sessions`, `sessions`, `log_session`) intactas.

### Achado — a ordem documentada estava errada
`context-step.ts` e `provision-step.ts` (que eu tinha classificado como
"Manter, genérico") **importam tipos do Supabase** (`DbClient`,
`AuthenticatedSession`) — fazem parte do mesmo cluster do `nio init` que
`project-step.ts`/`auth-step.ts`. Isso significa: **remover
`adapters/supabase/*` está bloqueado pelo redesenho do `nio init`**, não é
um passo independente que pode vir antes, como o documento dizia.

`sync.ts` também importava Supabase (telemetria + "overview do NOS" no
harness) — mas esses dois usos eram genuinamente best-effort (try/catch,
nunca bloqueavam). Corrigi: removidos os imports/blocos, `track(null, ...)`
já é no-op seguro. `nio sync --dry-run` rodando limpo até o fim confirma.

**Erro que quase cometi e corrigi antes de publicar**: ia listar
`src/core/ports.ts` inteiro pra remoção junto do adapter Supabase — mas o
arquivo tem `InvestigationGateway` (dual-IP read-only, propósito diferente,
ainda usado por `adapters/postgres/read-only.ts`) misturado no mesmo
arquivo que as interfaces v1. Corrigido na `TASK-remocao-v1.md`: é edição
parcial do arquivo, não apagar ele inteiro.

### Código alterado
| Arquivo | Mudança |
|---|---|
| `db/schema.sql` | Coluna `token_session`/índice removidos (fechando o Passo 0) |
| `db/migrations/0003_drop_token_session.sql` | Aplicada no banco de teste local |
| `src/cli/commands/sync.ts` | Removidos `createAuthenticatedClient`, `fetchProjectContext`/`buildProjectOverview` e o bloco de sessão best-effort — `telemetry` vira sempre `null`, harness sempre sem overview |
| `docs/v2/TASK-remocao-v1.md` | Reordenado (`nio init` é bloqueio real, não passo 2); `task-history.ts`/`core/ports.ts` (parcial) adicionados à tabela "Remover"; `context-step.ts`/`provision-step.ts` tirados do "Manter" |

### Verificação
- `bunx tsc --noEmit` → verde. `bun test` → 229/231 (mesmas 2 de sempre).
- `nio sync --dry-run` rodando até o fim sem erro, sem nenhuma referência a
  Supabase no arquivo.

### Próximo passo
1. Redesenho do `nio init` (bloqueio real pro resto da limpeza v1) — sub-tarefa
   de design, ver `docs/v2/ARQUITETURA-CLIENTE-IA.md`.
2. Depois disso: `adapters/supabase/*`, `core/ports.ts` (edição parcial),
   `task-history.ts`, `auth.ts`, `database.types.ts`, `package.json`.
3. 2º fator — pausado por decisão do dono do projeto (abandonando Twilio,
   avaliando TOTP self-hosted; ver conversa em andamento, ainda sem entrada
   própria de arquitetura registrada).

---

## 2026-08-25 — Redesenho do `nio init` fechado + `EnvironmentBuilder` mapeado

Auditoria de retomada do redesenho do `nio init`. Achado principal: as três
tarefas concretas de `TASK-cliente-ia-fixo.md` **já estavam feitas** (não
tinham entrada de log própria) e nenhum step do `init` importa mais Supabase.
O que faltava era mapear a peça grande que sobrou — a materialização do
ambiente.

### Estado confirmado (lendo o código)
- **`TASK-cliente-ia-fixo` — Tarefas 1-3 concluídas**: `KNOWN_CLIENTS` já inclui
  `opencode` (`skills.ts:151`); `installOpencodeGlobal`/`planOpencodeUpdate`
  já escrevem `model: "opencode/big-pickle"` (default soft, `NIO_OPERATOR_MODEL`);
  `nio init` já faz o handoff (`handoffToOperator` → `spawn('opencode', …,
  { stdio: 'inherit' })`) e mostra o logo antes do wizard.
- **`nio init` v2**: `resolveSessionSetup` roda o wizard de perfil + cria a
  `Session` (1º consumidor real do `SessionRepository`) — sem vínculo a projeto
  do NOS. Steps `auth/profile/context/provision` sem Supabase.
- **`project-step.ts` ficou órfão** — o `index.ts` não o importa mais, mas o
  arquivo (+ `.test.ts`) segue no repo importando Supabase. É o dominó que
  destrava a remoção do cluster Supabase da `TASK-remocao-v1.md`.
- `tsc --noEmit` verde; `bun test` 229 pass / 4 fail (as 4 são a dívida
  ambiental de sempre — 2× `cowork-extension` stale, 2× symlink EPERM no
  Windows; nenhuma do `init`).

### Mapeado (novo doc)
`docs/v2/ARQUITETURA-ENVIRONMENT-BUILDER.md` — pipeline `Profile →
ProfileDefinition (catálogo hardcoded em src/profiles/) → EnvironmentBuilder
→ materializa toolchains (adapters/pkg) + MCPs (opencode.json global) →
EnvironmentConfig → sessions.config`. Decisões travadas com o dono do projeto:
1ª fatia inclui **MCPs + toolchains** (não só MCPs); `opencode.json`
**global**. O alvo (`EnvironmentConfig`) e a persistência
(`SessionRepository.updateConfig`) já existem — falta o catálogo, os ports
(`ProfileCatalog`/`ToolchainGateway`) e o `EnvironmentBuilder` (app layer),
todos inexistentes hoje.

### Próximo passo
1. Implementar a fatia 1 do `EnvironmentBuilder` (ver "Ordem de construção" no
   doc novo): `src/profiles/` + `ProfileDefinition` com **1 perfil** (`dba` ou
   `analyst`) de ponta a ponta.
2. Remover `project-step.ts` órfão (destrava o cluster Supabase da
   `TASK-remocao-v1.md`).

---

## 2026-08-25 — EnvironmentBuilder: fatia 1 (perfil → MCPs) entregue

Primeira fatia vertical do `EnvironmentBuilder` (Tarefas 1-3 da
`TASK-environment-builder.md`). O `Profile` escolhido no `nio init` agora
materializa MCPs no `opencode.json` e popula `sessions.config` — antes o
perfil só virava a string `sessions.profile`. Toolchains (instalação real) e
envVars/aliases ficam pras próximas fatias (Tarefas 4-5).

### Código adicionado/alterado
| Arquivo | Papel |
|---|---|
| `src/core/environment.ts` (novo) | Vocabulário do ambiente: `ProfileDefinition`, `McpSpec`, `ToolchainSpec` + port `ProfileCatalog`. Core puro, sem IO |
| `src/profiles/{dba,index}.ts` (+ `profiles.test.ts`) | Catálogo hardcoded; `createProfileCatalog()` implementa `ProfileCatalog.get` (lança claro em perfil não-modelado). 1º perfil: `dba` (MCP postgres + toolchain `psql`) |
| `src/app/environment-builder.ts` (+ `.test.ts`) | `EnvironmentBuilder.build(profile)` → `{ config: EnvironmentConfig, mcps: McpSpec[] }`. Fatia 1: só MCPs + metadados (languages/frameworks) |
| `src/lib/client-configs.ts` (+ testes) | `planOpencodeUpdate`/`installOpencodeGlobal` ganharam `profileMcps` — funde os MCPs do perfil junto do `mcp.nio` (spread defensivo, idempotente, preserva chaves do usuário) |
| `src/cli/commands/init/clients-step.ts` | `installClients`/`CLIENT_INSTALLERS` threadam os `McpSpec[]` até `installOpencodeGlobal` |
| `src/cli/commands/init/index.ts` | `resolveSessionSetup` chama o builder após criar a `Session`, faz `updateConfig(session.id, env.config)` e passa `env.mcps` adiante. Falha parcial (perfil sem definição) só avisa e segue — a sessão já existe |

### Decisões
- Port `ProfileCatalog` em `src/core/environment.ts` (novo), **não** em
  `core/ports.ts` (legado v1) nem em `repositories.ts` (só persistência).
- `ProfileDefinition` (tipos) fica em `core/` e o catálogo (`src/profiles/`)
  importa de lá — respeita o hexágono (adapter depende de core, não o inverso).
- 1º perfil implementado: `dba`. Os outros 5 lançam erro claro no catálogo até
  serem modelados (Tarefa 6).

### Verificação
- `tsc --noEmit` verde. `bun test` 231 pass / 4 fail (as mesmas 4 pré-existentes:
  `cowork-extension` ×2, symlink EPERM ×2 — nenhuma nova).
- Unit: catálogo (get + erro), `planOpencodeUpdate` (merge/idempotência/preserva
  chaves), builder (dba resolve, perfil ausente propaga).
- **Suíte de integração no ambiente real** (`init-fatia1.integration.test.ts`):
  executa o pipeline do `nio init` pós-prompts contra o **Postgres vivo**
  (`192.168.0.142/NIO_CLI`) + um `opencode.json` real — cria usuário/sessão
  descartáveis, materializa, lê de volta do banco (`config.mcps` tem `postgres`,
  `config.languages` tem `sql`) e valida o `opencode.json` (`model` +
  `mcp.nio` + `mcp.postgres`), limpando tudo ao fim (0 resíduos confirmado).
  Gated em `NIO_DATABASE_URL` (pula sem banco). **1 pass / 8 asserts.** Precisou
  de um seam de path opcional em `installOpencodeGlobal` (não tocar no arquivo
  real do usuário no teste).

### Próximo passo
1. Tarefa 4 — `ToolchainGateway` + `adapters/pkg/` (instalação real; o passo de
   maior risco, isolado).
2. Tarefas 5-6 — envVars/aliases → dotfiles; completar os 6 perfis.

---

## 2026-08-25 — EnvironmentBuilder: fatia 2 (toolchains) + unblock do telemetry

Tarefa 4 da `TASK-environment-builder.md`: `ToolchainGateway` + `adapters/pkg/`.
O `EnvironmentBuilder` agora **garante toolchains** (detecta/instala) além dos
MCPs, e popula `config.toolchains` só com o que materializou.

### Código adicionado/alterado
| Arquivo | Papel |
|---|---|
| `src/core/environment.ts` | + `EnsureResult` (`present`/`installed`/`failed`) e port `ToolchainGateway` (contrato: **nunca lança**) |
| `src/adapters/pkg/toolchain-gateway.ts` (+ teste) | `ensure(spec)`: detecta por `globExists` (reusado de `dependency-install`, agora exportado); instala via `spawnSync` SEM shell; confirma detecção pós-install; falha → `status: 'failed'` |
| `src/lib/dependency-install.ts` | `globExists` passou a ser `export` (reuso do adapter — conforme a TASK) |
| `src/app/environment-builder.ts` (+ testes) | injeta `ToolchainGateway`; `build` garante cada toolchain, entra em `config.toolchains` só `present`/`installed`; devolve `toolchains: EnsureResult[]` pro chamador avisar |
| `src/cli/commands/init/index.ts` | reporta toolchains com `status: 'failed'` (aviso, não aborta) |

### Unblock — `telemetry.ts` desacoplado (limpeza Supabase do 2º agente, fora de ordem)
Durante a Tarefa 4, a limpeza concorrente do Supabase apagou `adapters/supabase/*`
**antes** de desacoplar `telemetry.ts` (invertendo a ordem "de fora pra dentro"
da `TASK-remocao-v1.md`), deixando o `tsc` vermelho (2 erros: `telemetry.ts`
importando o adapter apagado; `index.ts` com a chamada `flushTelemetry` mas sem
o import — este removido indevidamente, `index.ts` não é do escopo Supabase).
Com autorização do dono do projeto, apliquei o passo documentado:
- `telemetry.ts`: removido `import DbClient`; `track(supabase, event)` →
  `track(event)` **no-op** (o sink era o Supabase; sem destino v2 ainda, a
  interface fica pros call sites). `flushTelemetry` mantida (early-return).
- Call sites: `provision-step.ts` e `sync.ts` (`track(null/telemetry, …)` →
  `track(…)`; removido o `const telemetry = null` órfão).
- `index.ts`: restaurado o import de `flushTelemetry`.

### Verificação
- `tsc --noEmit` verde. `bun test` 230 pass / 4 fail (as 4 pré-existentes de
  sempre; o total caiu 2 porque o 2º agente apagou `project-step.test.ts`/
  `task-gateway.test.ts`). EnvironmentBuilder + integração juntos: **18/18**.
- Toolchain: adapter (detect present via path relativo — evita o bug conhecido
  de `globExists` com path absoluto no Windows; no-plan → failed) e builder com
  gateway fake (materializado entra no config; failed fica fora, não aborta).

### Próximo passo
1. Tarefas 5-6 — envVars/aliases → dotfiles; completar os 6 perfis do catálogo.
2. Coordenar com o 2º agente: `telemetry.ts` + call sites já estão feitos
   (não refazer); `index.ts` é do cluster `init`, não do escopo Supabase.

---

## 2026-08-25 — EnvironmentBuilder: fatia 3 (dotfiles) + 6 perfis — COMPLETO

Tarefas 5 e 6 da `TASK-environment-builder.md` — fecha o EnvironmentBuilder.

### Tarefa 5 — envVars/aliases → dotfiles gerenciados (decisão: arquivo em ~/.nio)
Decisão do dono do projeto: materializar num **arquivo gerenciado sob `~/.nio`**
(não no rc do usuário) — não-destrutivo, reversível, cross-platform.
| Arquivo | Papel |
|---|---|
| `src/lib/dotfiles.ts` (+ teste) | `writeManagedDotfiles({envVars,aliases})` → `~/.nio/profile.sh` (bash/zsh) + `profile.ps1` (PowerShell). Bloco entre marcadores `# >>> nio managed >>>`, idempotente e não-destrutivo (preserva o resto do arquivo). Sem envVars/aliases → `skipped`. Seam de path (`opts.dir`) pra teste |
| `src/app/environment-builder.ts` | `build` passou a incluir `envVars`/`aliases` no `config` (declarativo) |
| `src/cli/commands/init/index.ts` | após materializar, escreve os dotfiles (best-effort) e orienta o `source` |
Arquitetura: o `build` só declara (config); quem escreve o arquivo é o `init`
(espelha o padrão dos MCPs → `installClients`), então `build` não polui `~/.nio`
real nos testes.

### Tarefa 6 — os 6 perfis no catálogo
| Arquivo | Perfil |
|---|---|
| `src/profiles/{fullstack,analyst,scientist,qa,bi}.ts` | Os 5 restantes (dba já existia) |
| `src/profiles/{mcps,toolchains}.ts` | Specs compartilhados (postgres MCP; node/python toolchains) — DRY |
| `src/profiles/index.ts` | `DEFINITIONS` virou `Record<Profile,…>` completo (6/6) |
Honestidade de catálogo: só entram MCPs com comando verificável (`postgres` =
reference server). PowerBI (analyst/bi) fica como **TODO comentado**, não spec
fictícia (evita `opencode.json` quebrado). Toolchains node/python têm `detect`
Unix; no Windows o `globExists` tem limitação conhecida com path absoluto → o
toolchain sai `failed` (aviso, não-fatal, por design).

### Verificação
- `tsc --noEmit` verde. `bun test` **235 pass / 4 fail** (as 4 pré-existentes;
  a integração da fatia 1 contra o Postgres real segue verde).
- Testes novos: dotfiles (escreve sh+ps1, idempotente, não-destrutivo, empty→skip),
  catálogo (os 6 resolvem; inexistente lança), builder (envVars/aliases no config).

### Estado
**EnvironmentBuilder completo** (fatias 1-3, Tarefas 1-6): perfil → toolchains +
MCPs + envVars/aliases → `sessions.config` + `opencode.json` + `~/.nio/profile.*`.
Pendências conhecidas (não bloqueantes): comando real do PowerBI MCP; fix do
`globExists` p/ path absoluto no Windows; auth interativo dos MCPs (segredo).

---

## 2026-08-25 — Context7 como MCP-base de todo perfil

Melhoria pedida pelo dono do projeto: o operador de IA deve sempre puxar a doc
mais recente das linguagens/frameworks da stack, em vez de depender só do
conhecimento congelado do modelo. Implementado com o **Context7** (Upstash,
`@upstash/context7-mcp` — MCP real e verificável, roda anônimo).

### Decisão de design
Não é MCP por perfil — é **base de TODOS**. Adicionado em `BASE_MCPS` no
`EnvironmentBuilder` (`app/environment-builder.ts`), mesclado antes dos MCPs
específicos (`mergeMcps`, dedupe por `id`, perfil vence se repetir). Assim:
- Vale para os 6 perfis **e** para qualquer perfil futuro, sem precisar declarar.
- Cai em `config.mcps` (→ `sessions.config`) e no `opencode.json` como qualquer MCP.

### Código
| Arquivo | Mudança |
|---|---|
| `src/profiles/mcps.ts` | + `context7Mcp` (`npx -y @upstash/context7-mcp`; `CONTEXT7_API_KEY` opcional só sobe limites) |
| `src/app/environment-builder.ts` | `BASE_MCPS = [context7Mcp]` + `mergeMcps(base, def.mcps)`; `config.mcps` e o retorno usam o merge |
| `src/app/environment-builder.test.ts` | + caso: context7 presente em `bi` (sem MCP próprio) e junto de `postgres` no `dba` |
| `init-fatia1.integration.test.ts` | reforço: `context7` no `sessions.config` **e** no `opencode.json` reais |

### Verificação
- `tsc` verde. `bun test` **236 pass / 4 fail** (as 4 pré-existentes). Integração
  real (Postgres + opencode.json) confirma context7 materializado ponta a ponta.

---

## 2026-08-25 — Pivô: context7 removido → `nio-lang` (MCP server nativo), fatia 1

Decisão do dono do projeto: **dropar o context7** e criar um **MCP server nativo
da CLI (`nio-lang`)** que centraliza config/conhecimento das linguagens
(Python/TS/Node/C#/n8n), vendorando 5 repos via fetch-cache. Ver
`docs/v2/ARQUITETURA-NIO-LANG.md`. context7 saiu do código (BASE_MCPS vazio →
agora recebe o `nio-lang`).

### Fatia 1 (camada de conhecimento) — código
| Arquivo | Papel |
|---|---|
| `src/core/lang.ts` | `LanguageId`, `LangReference`, port `KnowledgeStore` (core puro) |
| `src/adapters/lang/knowledge-store.ts` (+ teste) | Lê o README do repo vendorado em `~/.nio/lang/<repo>/`; cache ausente → `found:false` com "rode `nio lang sync`". Seam de dir pra teste |
| `src/tools/lang-reference.ts` (+ teste) | Tool `nio_lang_reference(language, topic?)` — handler puro, store injetável |
| `src/mcp-server-lang.ts` | Entrypoint do server `nio-lang` (TS SDK, stdio, sem auth — conhecimento público) |
| `src/profiles/mcps.ts` | + `nioLangMcp` (`command: ['nio-lang']`) |
| `src/app/environment-builder.ts` | `BASE_MCPS = [nioLangMcp]` — base de todo perfil |
| `package.json` | bin `nio-lang` → `dist/mcp-server-lang.js`; `dev:lang`; chmod no build |

### Verificação
- `tsc` verde. Testes da fatia (core/adapter/tool/builder/integração): **12/12**.
- **Smoke real do server**: `bun run src/mcp-server-lang.ts` respondendo
  JSON-RPC — `initialize` devolve `serverInfo nio-lang`, `tools/list` devolve
  `nio_lang_reference` com o schema das 5 linguagens. Sobe e responde de verdade.
- Integração real (Postgres + opencode.json) confirma `nio-lang` no
  `opencode.json` gerado, como base de todo perfil.

### Próximo passo
1. Fatia 2 — `nio lang sync`: fetch/vendor dos 5 repos pro cache (git clone,
   ref fixada), o que enche o `nio_lang_reference` de conteúdo real.
2. Fatias 3-6 — `LanguageCatalog`+recipes, `ScaffoldGateway`+wizard fullstack,
   `n8n-mcp` como MCP próprio, expandir camada B.

---

## 2026-08-25 — nio-lang fatia 2: `nio lang sync` (vendoring dos 5 repos)

O `nio_lang_reference` deixou de ser plumbing vazio — agora serve conteúdo real.

### Código
| Arquivo | Papel |
|---|---|
| `src/adapters/lang/repos.ts` | Fonte única linguagem → `{dir, repo, ref}` dos 5 repos (usada por vendor + knowledge-store) |
| `src/adapters/lang/vendor.ts` (+ teste) | `syncLangRepos()` — baixa cada repo (zipball GitHub via `fetch`+`adm-zip`, sem `git`, timeout, best-effort por repo). Mesmo padrão do `skills-cache`. Seam de dir |
| `src/adapters/lang/knowledge-store.ts` | Refatorado pra usar `LANG_REPOS` (tira o mapa duplicado) |
| `src/cli/commands/lang.ts` | `nio lang sync [--force]` — baixa/atualiza o cache, reporta status por repo |
| `src/cli.ts` | Registra o comando `lang` |

### Verificação
- `tsc` verde. `bun test` **237 pass / 4 fail** (as 4 pré-existentes). Teste do
  vendor cobre o caminho `cached` (offline, determinístico).
- **Smoke real**: `nio lang sync` baixou os **5/5** repos (`main` era o ref certo)
  → cache em `~/.nio/lang/`. O `KnowledgeStore` passou a devolver `found:true`
  com conteúdo real (TS 8278, Python 5724, C# 3959, Node 9309, n8n 20775 chars).
  Pipeline `sync → cache → nio_lang_reference` fechado ponta a ponta.

### Próximo passo
- Fatia 3 — `LanguageCatalog` + recipes (1 linguagem ponta a ponta).
- Depois: `ScaffoldGateway` + wizard fullstack de pré-config; `n8n-mcp` como MCP próprio.

---

## 2026-08-25 — nio-lang fatia 3: `LanguageCatalog` + recipes + tool `nio_lang_recipe`

Feita em modo colaborativo (dono do projeto escreveu o catálogo de recipes; eu
fiz o contrato, a tool e o wiring, e validei/corrigi o catálogo).

### Código
| Arquivo | Papel |
|---|---|
| `src/core/lang.ts` | + `LanguageRecipe` (runtime, `packageManagers[]`, baseLibs, frameworks, orms, typings, mcpSdk?) e port `LanguageCatalog` |
| `src/adapters/lang/language-catalog.ts` (+ teste) | Recipes hardcoded das 5 linguagens (frameworks/ORMs por linguagem escolhidos pelo dono do projeto); `createLanguageCatalog()` lança em linguagem sem recipe |
| `src/tools/lang-recipe.ts` (+ teste) | Tool `nio_lang_recipe(language)` — handler puro, catálogo injetável |
| `src/mcp-server-lang.ts` | Registra a 2ª tool (`nio_lang_recipe`) ao lado da `reference` |

### Validação da parte do dono do projeto (correções aplicadas)
Catálogo veio com bugs mecânicos: nome do arquivo (`catolog`→`catalog`), import
`'../..core'`→`'../../core'`, `packageManager` com múltiplos valores (→ contrato
virou `packageManagers: string[]`), `language:'Node.js e Typescript'`→`'node'`,
`testing:`→`typings:`, vírgulas faltando em ORMs, `}` sobrando. Dados: `mcpSdk`
de python/csharp/n8n eram pacotes inventados → corrigidos pros reais
(`mcp`, `ModelContextProtocol`, `undefined` p/ n8n). Listas de frameworks/ORMs
preservadas como o dono do projeto escreveu.

### Verificação
- `tsc` verde. `bun test` **244 pass / 4 fail** (as 4 pré-existentes).
- **Smoke real** (JSON-RPC): `tools/list` do `nio-lang` agora devolve **2 tools**
  (`nio_lang_reference` + `nio_lang_recipe`); `tools/call nio_lang_recipe`
  (typescript) retorna a recipe real (packageManagers, frameworks, ORMs).

### Próximo passo
- Fatia 4 — `ScaffoldGateway` (instala/gera de verdade) + wizard fullstack de
  pré-config de linguagens (o passo de maior risco, isolado).
- Fatias 5-6 — `n8n-mcp` como MCP próprio; refinar `topic` do `reference`.

---

## 2026-08-25 — nio-lang fatia 4a: `ScaffoldGateway` (plano + dry-run, isolado)

Fase de maior risco — feita **com cautela**: só o esqueleto seguro (plano +
dry-run), homologado em diretório temporário. **Execução real NÃO habilitada
ainda** (gate pro dono do projeto revisar o plano).

### Código
| Arquivo | Papel |
|---|---|
| `src/core/lang.ts` | + `ScaffoldChoices`, `ScaffoldStep` (run/write), `ScaffoldPlan`, `ScaffoldStepResult`, port `ScaffoldGateway` |
| `src/adapters/lang/scaffold-gateway.ts` (+ teste) | `plan()` sem IO; `apply({dryRun})` devolve tudo `planned` sem tocar nada; execução real via `spawnSync` sem shell, sempre dentro do `targetDir`; nunca lança |

### Isolamento por construção
- `plan()` só descreve. `apply(dryRun)` não executa nem escreve — o teste prova
  (`targetDir` continua vazio depois do dry-run).
- Framework/ORM **não** são auto-instalados nesta fatia (generators específicos
  = risco) — ficam registrados num marker `.nio-lang.json`. Plano atual por
  linguagem: init do package manager + tipagens + marker.

### Homologação (ambiente de teste)
Dry-run de typescript (Next.js/Prisma) num tmp dir mostra o plano sem executar:
`npm init -y` · `npm install -D typescript @types/node` · escreve `.nio-lang.json`.

### Verificação
- `tsc` verde. `bun test` **247 pass / 4 fail** (as 4 pré-existentes). 17 testes lang.

### Débito/gate
- **Wizard fullstack**: ainda NÃO plugado — próximo passo (fatia 4b).
- Nota: o arquivo `language-catolog.ts` (typo) reapareceu 1× via editor;
  removido. O correto é `language-catalog.ts`.

---

## 2026-08-25 — nio-lang fatia 4a (cont.): homologação da execução real (opt-in)

Teste de homologação gated do `apply` real, aprovado pelo dono do projeto.

### Código
| Arquivo | Papel |
|---|---|
| `src/adapters/lang/scaffold-apply.homolog.test.ts` | Homologação opt-in: só roda com `NIO_SCAFFOLD_APPLY=1` (CI nunca seta → pula). Instala de verdade (npm) num tmp dir descartável; guarda que recusa executar fora do temp do SO; cleanup no `finally` |

### Verificação
- Sem o flag: **pula** (suíte default `247 pass / 1 skip / 4 fail` — nenhuma
  instalação acidental).
- **Homologação real** (`NIO_SCAFFOLD_APPLY=1`, rodada 1×): passou — `npm init` +
  `npm install -D typescript @types/node` ("added 4 packages in 4s") + marker,
  num tmp dir, limpo depois. `package.json` com `typescript`/`@types/node` em
  devDependencies confirmado. O `apply` real funciona ponta a ponta, isolado.

### Próximo passo (gate)
- Fatia 4b — plugar o `ScaffoldGateway` no wizard fullstack do `nio init`
  (pré-config de linguagens). Agora com a execução real já homologada isolada.

---

## 2026-08-25 — nio-lang fatia 4b: wizard fullstack de pré-config plugado

Modo colaborativo (dono do projeto escreveu os prompts; eu fiz o orquestrador,
o gate e o wiring). O `nio init` no perfil **fullstack** agora oferece
pré-configurar linguagens, com preview + confirmação antes de instalar.

### Código
| Arquivo | Papel |
|---|---|
| `src/app/language-configurator.ts` (+ teste) | Orquestra: por linguagem, plano → **preview (dry-run)** → `confirm` → apply REAL só se confirmado. `confirm` injetável. Teste prova: não-confirmado ⇒ zero execução |
| `src/cli/commands/init/lang-step.ts` | Prompts `pickLanguages` (multi-select) + `pickLanguageChoices` (pm/framework/ORM da recipe). Feito pelo dono do projeto; validei/completei o select de ORM (tinha ficado no placeholder) |
| `src/cli/commands/init/index.ts` | `preConfigureLanguages()` (só `profile === 'fullstack'`): wizard → configurator com `confirm` real que imprime o preview e pergunta antes de aplicar no `process.cwd()` |

### Verificação
- `tsc` verde. `bun test` **250 pass / 1 skip / 4 fail** (as 4 pré-existentes; o
  skip é o homolog opt-in do scaffold). Gate confirm-recusa coberto por unit test.
- Smoke interativo real (TTY, com `confirm` recusando) fica como passo manual —
  mesma limitação do resto do wizard `nio init` (@clack exige TTY).

### Próximo passo
- Fatia 5 — `n8n-mcp` registrado como MCP próprio (server de verdade).
- Fatia 6 — refinar `topic` do `nio_lang_reference`; instalar framework/ORM de
  verdade (generators por-framework) — hoje ficam no marker `.nio-lang.json`.

---

## 2026-08-25 — nio-lang fatia 5: `n8n-mcp` como MCP próprio

`n8n-mcp` (czlonkowski) é um server MCP de verdade — registrado **ao lado** (não
dobrado no `nio-lang`) quando o usuário escolhe a linguagem `n8n` no wizard.

### Verificação do comando (via repo vendorado)
Li `~/.nio/lang/n8n-mcp/package.json`: pacote npm `n8n-mcp` v2.73.0, bin stdio
(`dist/mcp/stdio-wrapper.js`). README confirma: roda **sem auth** para as tools
de documentação de nodes/workflows; `N8N_API_URL`/`N8N_API_KEY` (opcionais) só
habilitam as de gerenciar workflow ao vivo. Comando: `npx -y n8n-mcp`.

### Código
| Arquivo | Papel |
|---|---|
| `src/profiles/mcps.ts` (+ teste) | + `n8nMcp` (`npx -y n8n-mcp`, sem env — docs sem auth) |
| `src/cli/commands/init/index.ts` | `preConfigureLanguages()` passou a devolver as linguagens escolhidas; se inclui `n8n`, registra o `n8nMcp` no `opencode.json` (via `mcps`) e adiciona `'n8n'` ao `sessions.config.mcps` |
| `src/app/environment-builder.test.ts` | teste-guarda: `n8n` **não** é base nem MCP de perfil (só entra por seleção no wizard) |

### Verificação
- `tsc` verde. `bun test` **253 pass / 1 skip / 4 fail** (as 4 pré-existentes;
  skip = homolog opt-in). Guarda de "n8n não é base" cobre regressão.

### Próximo passo
- Fatia 6 — refinar `topic` do `nio_lang_reference` (busca dentro do conteúdo
  vendorado, não só README); install real de framework/ORM (generators).

---

## 2026-08-25 — nio-lang fatia 6 (FECHA): topic search + install ciente de contexto

Última fatia. Modo colaborativo (dono do projeto: mapa display→pacote; eu:
contrato, detector, topic search, wiring). **Adendo do dono do projeto**: a CLI
só instala "de acordo com o projeto que ela estiver relacionada, ou mediante
perguntas e aprovação" — virou o eixo do design.

### Parte 1 — `topic` no `nio_lang_reference` (read-only)
`knowledge-store` passou a buscar o `.md` mais relevante dentro do repo vendorado
(nome do arquivo pesa alto, ocorrências somam), não só o README. Sem match →
README com aviso. Smoke real: `reference('n8n','authentication')` achou
`n8n-mcp/data/skills/.../OPERATION_PATTERNS.md`.

### Parte 2 — scaffold ciente de contexto
| Arquivo | Papel |
|---|---|
| `src/core/lang.ts` | + `ProjectContext`, port `ProjectDetector`, port `PackageMap` |
| `src/adapters/lang/project-detector.ts` (+ teste) | Lê o dir (read-only): vazio? package.json/pyproject/.csproj? pm por lockfile |
| `src/adapters/lang/package-map.ts` (+ teste) | Mapa display→pacote (TS/Node/Python/C#). Dono do projeto preencheu TS; completei node/python/csharp |
| `src/adapters/lang/scaffold-gateway.ts` (reescrito, testes) | `plan()` usa detector + mapa: **greenfield** = init+tipagens+instala pacotes; **brownfield compatível** = só adiciona a dep (sem re-init); **incompatível/sem-mapa** = só marker. Sempre via dry-run+confirm |

### Verificação
- `tsc` verde. `bun test` **263 pass / 1 skip / 4 fail** (as 4 pré-existentes;
  skip = homolog opt-in do scaffold).
- Demo dry-run confirmou os 3 contextos: greenfield instala; brownfield só
  adiciona (sem init, não-destrutivo); Python-em-projeto-Node não instala nada.

## 2026-08-25 — Limpeza do Supabase FECHADA

Auditoria + finalização do que o 2º agente deixou pela metade. Estado achado: ele
apagou `adapters/supabase/*`, `project-step`, `project-context`, `task-history`,
`auth.ts`(+teste), editou `ports.ts`/`render.ts` e limpou `constants.ts`. Faltava:
`database.types.ts` + `@supabase/supabase-js`/`gen:types` no `package.json`.

### Finalizado por mim
- Apagado `src/database.types.ts` (zero importadores, confirmado).
- Removidos `@supabase/supabase-js` (dep) e o script `gen:types` do `package.json`;
  `bun install` (1 package removed, lockfile atualizado).
- `patPrefix`/`patRegex` em `brand.ts` **mantidos** de propósito (ainda usados por
  `cowork-extension.ts` — só saem quando o módulo Cowork sair).

### Verificação
- `tsc` verde. `bun test` **263 pass / 1 skip / 4 fail** (as 4 pré-existentes).
- `grep -ri supabase src package.json`: só **comentários** (core/types.ts,
  gateway/types.ts, telemetry.ts) — **zero código/dependência**.

### Débito residual (não é dependência Supabase)
- Comentários stale mencionando Supabase (`gateway/types.ts`, `telemetry.ts`) — cosmético.
- ~~`src/core/types.ts` tipos v1 órfãos~~ ✅ **feito**: auditado por uso (só
  `DbTarget`/`QueryResult` usados); ~20 tipos v1 removidos.
- `gen:docs` do README pode ser rerodado (tabela de tools) — polish.
- **PowerBI MCP**: comando placeholder — precisa do launch real (dono do projeto).

## 2026-08-25 — Suíte 100% verde (4 falhas ambientais zeradas)

Matança cirúrgica das 4 falhas pré-existentes → **266 pass / 2 skip / 0 fail**.
- **`brand.test.ts` "20 tools"** (stale): as 16 tools v1 (`nos_*`) foram removidas;
  teste atualizado p/ as 4 `nio_` de execução, sem `nos_`.
- **`cowork-extension.test.ts` metadados** (stale pós-rename): `display_name`
  `nio (NOS)`→`nio (NIO)`, `author.name` `Falcao-Tech`→`NIO` (brand.productName).
- **`globExists` no Windows** (bug real): path absoluto Windows caía em `start='/'`
  + segmento `C:` solto → nunca casava. Corrigido com `isAbsolute` + raiz real
  (`parse().root`). Mata a falha de `dependencies.test.ts` **E conserta a detecção
  de toolchain no Windows** (débito #5). 13/13.
- **`provision.test.ts` ensureDir symlink** (POSIX-only): no Windows `symlinkSync`
  p/ alvo inexistente cria link tipo-file → `mkdir` através nunca funciona.
  Pulado no Windows (`test.skip`), roda no CI/Mac/Linux.

As 2 skips restantes são legítimas: homolog opt-in do scaffold + o teste POSIX
acima.

## 2026-08-26 — Órfãos do Gateway removidos + comentários Supabase zerados

- **Gateway spec 0002 (OAuth/PKCE superseded)** — apagados após auditar que nada
  ativo os importa: `server.ts`, `sessions.ts`(+test), `pkce.ts`(+test),
  `authorize-page.ts`, `authorize-store.ts`, `traceability.ts`, `types.ts`.
  `tsconfig` exclude limpo (não precisa mais excluir `server.ts`). Gateway ativo
  intacto: `config`, `edge-filter`, `index`, `middleware/auth`, `services/login`.
- **Comentários stale de Supabase/NOS** — zerados em `config.ts`, `constants.ts`,
  `core/types.ts`, `session-store.ts`, `telemetry.ts` (2×), `sync.ts` (2×).
  `grep -ri supabase src package.json` → **zero**.
- **PowerBI MCP** — comando oficial portável fixado
  (`npx -y @microsoft/powerbi-modeling-mcp@latest --start --skipconfirmation`),
  placeholder removido.
- `tsc` verde. `bun test` **258 pass / 2 skip / 0 fail** (órfãos removidos tiraram
  ~8 testes de spec 0002).

## 2026-08-26 — 4 comandos novos de CLI (sessions/debug/agents/command)

- **`nio sessions`** — expõe o `SessionRepository` (que já estava pronto e ocioso):
  `list` (default), `activate <id>`, `pause <id>`, `delete <id>`. Resolução por
  prefixo de id (`matchByIdPrefix`, pura + testada). Exige login; erros de banco
  amigáveis.
- **`nio debug`** — doctor de diagnóstico (read-only): `nio.json`, login local,
  Postgres (ping), sessão ativa, OpenCode no PATH, `opencode.json`, cache de
  skills — cada um ✓/⚠/✗ com dica acionável. Smoke real apontou os problemas certos.
- **`nio agents`** — lista os agentes (`type: 'agent'`) do cache de skills. Smoke:
  5 agentes reais listados com descrição.
- **`nio command [name]`** — cria um slash-command personalizado em
  `~/.config/opencode/commands/<nome>.md` (frontmatter + corpo, interativo).
- `tsc` verde. `bun test` **259 pass / 2 skip / 0 fail**. Teste do helper puro
  `matchByIdPrefix`. Registrados no `cli.ts`.

### Teste de integração do SessionRepository (Postgres real)
`session-repository.integration.test.ts` (gated em `NIO_DATABASE_URL`, usuário
descartável) cobre o ciclo de vida completo + a invariante 1-ativa-por-usuário:
criar B arquiva A · list · findActive · activate (troca) · pause (zera ativa) ·
updateConfig (JSONB) · delete. **1 pass, 9 asserts**, limpeza confirmada (0
resíduos). Nota: em rodada cheia os 2 testes de DB remoto (fatia-1 + sessions)
às vezes flakeiam por latência de rede; em isolamento passam sólidos.

---

### nio-lang — COMPLETO (fatias 1-6)
Conhecimento (reference+topic) · `nio lang sync` (vendor) · recipes · scaffold
(dry-run+confirm+homolog opt-in) · wizard fullstack · n8n-mcp · install ciente
de contexto. Débito futuro (não-bloqueante): generators de projeto inteiro
(create-next-app) ficam de fora de propósito — só "add dependency" ao projeto.

---

## 2026-08-26 — Sprint 2.2: `IdeGateway` (abre a IDE na pasta do projeto)

Fecha a peça que faltava da materialização (Sprint 2.2 do doc de transição):
depois de montar o ambiente, abrir o editor na `session.projectPath`. Espelha o
padrão do `ToolchainGateway` (port em `core/` + adapter em `adapters/` + wiring
no `init`).

### Código adicionado/alterado
| Arquivo | Papel |
|---|---|
| `src/core/environment.ts` | + `OpenResult` (`opened`/`unavailable`/`skipped`/`failed`) e port `IdeGateway` (contrato: **nunca lança**, igual ao ToolchainGateway) |
| `src/adapters/ide/ide-gateway.ts` (+ teste) | `resolveLauncher(ide)` puro (vscode→`code`, cursor→`cursor`, terminal/other→null); detecta o binário por `--version` SEM shell (no Windows tenta `code.cmd` antes de `code`); abre **detached + unref** (a IDE sobrevive ao fim da CLI) |
| `src/cli/commands/init/index.ts` | `openSessionIde(session)` chamado antes do handoff — best-effort (`skipped` silencioso, resto só avisa, nunca aborta) |
| `src/cli/commands/open.ts` (novo) | `nio open` — abre a IDE da **sessão ativa** (`findActiveByUser`); é o critério de aceite do Sprint 2.2 |
| `src/cli.ts` | Registra o comando `open` |

### Decisões
- Launcher keyado no `Session.ide` (`terminal|vscode|cursor|other`) — o tipo de
  domínio persistido, não o `config.Ide` do wizard (`vscode|xcode|other`). Hoje o
  `toSessionIde` do `init` colapsa tudo não-vscode em `other`, então na prática só
  `vscode` abre; o gateway já está pronto pra `cursor` quando o wizard oferecer.
- Windows: `code`/`cursor` são shims `.cmd`; o spawn sem shell não resolve `.cmd`
  sozinho, então tentamos `<bin>.cmd` antes do nome cru — mantém `shell: false`
  (convenção de segurança do repo), sem cair em injeção.

### Verificação
- `tsc --noEmit` verde. `bun test` **264 pass / 2 skip / 0 fail** (as 4 novas do
  IdeGateway incluídas; nenhuma regressão).
- `nio open --help` registra e sobe. Abertura real da IDE fica como smoke manual
  (depende de `code`/`cursor` no PATH da máquina).

### Débito conhecido (não-bloqueante)
- `pickIde` do wizard ainda oferece `xcode` (colapsa em `other` → `skipped`) e não
  oferece `cursor` nem `terminal`. Alinhar o prompt ao union do `Session.ide` é
  polish separado.

### Próximo passo
- Sprints grandes que ainda faltam: DependencyWatcher (Sprint 3) e as tools MCP de
  ambiente (Sprint 4).

---

## 2026-08-26 — `pickIde` alinhado ao union do `Session.ide`

Fecha o débito da entrada anterior. Os dois vocabulários de IDE eram distintos:
`config.Ide` (`vscode|xcode|other`, integração do /implement) e `Session.ide`
(`terminal|vscode|cursor|other`, o IdeGateway). Unificados num **superset**.

| Arquivo | Mudança |
|---|---|
| `src/config.ts` | `Ide` virou `vscode\|cursor\|xcode\|terminal\|other`; + `IDE_VALUES` e `isIde()` (fonte única — eliminou os 4 guards literais repetidos de parse) |
| `src/cli/commands/init/profile-step.ts` | `pickIde` oferece VS Code / Cursor / Xcode / Terminal / Outra |
| `src/cli/commands/init/index.ts` | `toSessionIde` mapeia o superset (cursor/terminal passam direto; xcode→other, que o `Session.ide` não tem) |
| `src/cli/flows/user-config.ts` | Mesma lista no prompt de prefs do /implement (coerência) |

Verificação: `tsc` verde; `bun test` **264 pass / 2 skip / 0 fail** (guard de parse
coberto pelo teste existente — `vscode` preservado, `notepad` ignorado).

---

## 2026-08-26 — Sprint 3 fatia 1: scanner de dependências (puro)

Primeira fatia do DependencyWatcher (Sprint 3). Só a detecção de deps DECLARADAS
nos manifests do projeto — sem decidir instalado, sem persistir, sem loop (fatias
2-6). Lógica de parse **pura** (recebe conteúdo, não toca disco).

| Arquivo | Papel |
|---|---|
| `src/lib/dependency-scan.ts` (+ teste) | `parsePackageJson` (runtime+dev+peer+optional), `parseRequirementsTxt` (tira versão/extras/markers, ignora `#`/`-`/URLs), `parseCargoToml` (via `smol-toml`, já dep do projeto); `scanContent` (puro) + `scanProject` (IO best-effort por manifest). Tipos: npm/pip/cargo (do union `DependencyType`) |

Distinto de `dependencies.ts` (deps de skills no frontmatter) — aqui é o manifest
do projeto do usuário.

Verificação: `tsc` verde; `bun test` **270 pass / 2 skip / 0 fail** (6 novas do
scanner). Parsers cobertos por fixtures inline (dedupe, JSON/TOML inválido → vazio).

### Próximo passo (fatias 2-6, envolvem escrita no banco + processo em background)
2. Diff de instalados (o que falta). 3. `DependencyEventRepository` (pg →
`dependency_events`). 4. Auto-install (npm/pip/cargo, spawnSync sem shell).
5. Loop de 10s da sessão ativa. 6. `nio env detect` (scan manual) + wiring.

---

## 2026-08-26 — Sprint 3 fatias 2-6: DependencyWatcher COMPLETO

Fecha o DependencyWatcher. Pipeline ponta a ponta: scan dos manifests da sessão
ativa → diff de instalados → registra evento (idempotente) → auto-install opt-in.

### Decisões de escopo (dono do projeto)
- **Auto-install é opt-in** (`--install`), não automático: detecção + registro de
  eventos sempre ligados (observabilidade segura); a instalação real (ação
  destrutiva) só com a flag. Diverge do doc §3.4 ("sem pedir permissão") de
  propósito — alinha ao padrão de gate do repo (scaffold/language-configurator).
- **Sem daemon**: `nio deps watch` é loop em foreground (Ctrl+C encerra), não
  processo em background — gerência de processo cross-platform fica fora de escopo.

### Código adicionado/alterado
| Arquivo | Papel |
|---|---|
| `src/lib/dependency-installed.ts` (+ teste) | `isInstalled` (npm→`node_modules/<name>`; pip→site-packages de venv POSIX+Win; cargo→`Cargo.lock`) + `missingDependencies` (check injetável) |
| `src/core/repositories.ts` | + port `DependencyEventRepository` (`recordIfNew` idempotente por session+file+name, `markInstalled`, `listBySession`) |
| `src/adapters/pg/dependency-event-repository.ts` (+ teste do mapper) | Impl Postgres; `recordIfNew` deduplica em transação |
| `src/lib/dependency-install-project.ts` | `installProjectDeps(type, path)` — instalador do ecossistema no `cwd` (`npm install`/`pip install -r`/`cargo fetch`), spawnSync SEM shell, zero arg do usuário |
| `src/app/dependency-watcher.ts` (+ teste) | `DependencyWatcher.tick` (scan→diff→recordIfNew→install opt-in) + `watch` (loop 10s abortável via `AbortSignal`); seams de IO injetáveis |
| `src/cli/commands/deps.ts` + `cli.ts` | `nio deps scan [--install]` (one-shot = o "detect" do doc) e `nio deps watch [--install]` sobre a sessão ativa |

Tabela `dependency_events` já existia no schema — sem migration nova.

### Verificação
- `tsc --noEmit` verde. `bun test` **276 pass / 2 skip / 0 fail** (6 novas:
  watcher ×3 com repo/seams fake, diff ×2, mapper ×1). `nio deps --help` lista
  `scan`/`watch`.
- Smoke real (`nio deps scan` contra Postgres vivo + sessão ativa) fica como passo
  manual — gated em `NIO_DATABASE_URL` + login, como os outros fluxos de banco.

### Débito conhecido (não-bloqueante)
- Detecção de instalado de `pip`/`cargo` é heurística de filesystem (venv comuns /
  Cargo.lock); `gem`/`composer`/`unknown` ainda não checados nem instalados.
- Teste de integração do `DependencyEventRepository` contra Postgres real (como o
  do `SessionRepository`) fica pra uma próxima rodada.

---

## 2026-08-26 — Sprint 4 fatias 4.0→4.2: `SessionManager` + 3 tools MCP de ambiente

Início do Sprint 4 (tools MCP de ambiente). Decisões do dono do projeto: (a)
introduzir o `SessionManager` (nomeado na CLAUDE.md, nunca existiu) como base
única das tools e da CLI; (b) as tools **não** mexem no `opencode.json` — só
persistem em `sessions.config` e devolvem os `McpSpec[]` como dado; (c) entregar
4.0→4.2 num bloco.

### Fatia 4.0 — `SessionManager` (app layer) + refactor dos consumidores
| Arquivo | Papel |
|---|---|
| `src/app/session-manager.ts` (+ teste) | Orquestra `SessionRepository` + `EnvironmentBuilder`. Resolução por prefixo de UUID mora aqui, com erros tipados (`SessionNotFoundError`/`AmbiguousSessionError`). Métodos: `list`/`resolve`/`resolveOrActive`/`findActive`/`activate`/`setStatus`/`updateConfig`/`delete`/`create`/`materialize`. Repo + builder injetáveis (default reais) |
| `src/core/environment.ts` | + `ProfileCatalog.list()` (as 6 definições) |
| `src/profiles/index.ts` | implementa `list()` |
| `src/cli/commands/sessions.ts` | reescrito fino sobre o `SessionManager` (sai `matchByIdPrefix` local + `resolve`/`withRepo` duplicados) |
| `src/cli/commands/init/index.ts` | `resolveSessionSetup` troca `createSessionRepository()` + `new EnvironmentBuilder()` inline por `manager.create()` — `MaterializedSession` carrega `materializeError` p/ preservar a resiliência (sessão criada não se perde se a materialização falha) |
| `src/cli/commands/sessions.test.ts` | removido — `matchByIdPrefix` agora vive e é testado no `session-manager.ts` |

**`create` vs `materialize`**: `create` faz a materialização best-effort (falha →
`materializeError`, sessão preservada); `materialize` re-roda numa sessão que já
existe, então a falha **propaga**.

### Fatia 4.1 — `nio_profile_get` (read-only, sem DB)
`src/tools/profile-get.ts` (+ teste). Sem arg → os 6 perfis resumidos
(languages/frameworks/toolchain-ids/mcp-ids); com `{ profile }` → definição
completa (+ `mcpSpecs`/`toolchainSpecs` com comandos e planos). Perfil inválido →
`errorResult`, não lança.

### Fatia 4.2 — `nio_session_list` + `nio_session_activate`
`src/tools/session-list.ts` / `session-activate.ts` (+ `session-shared.ts` com
`sessionView`/`sessionErrorResult`/`failedToolchains`, + teste). Núcleo testável
(`runSessionList`/`runSessionActivate`) separado do `handler(args, ctx)` que
injeta o `SessionManager` real e `ctx.user.id`. Erros de resolução viram mensagem
direta; falha de banco vira "Falha ao acessar as sessões: …".

As 3 tools registradas em `src/tools/index.ts` (4 → 7). `brand.test.ts`
atualizado (não checa mais count exato — `arrayContaining` das conhecidas).
`gen:docs` rodado (README: 7 tools + parágrafo de status atualizado).

### Verificação
- `tsc --noEmit` verde. `bun test` **297 pass / 1 skip / 2 fail**.
- As 2 falhas são **ambientais**, não regressão: `.env` local tem
  `NIO_DATABASE_SSL=true` contra o Postgres do Homebrew (que não faz SSL) →
  `session-repository.integration` + `init-fatia1.integration` quebram. Com
  `NIO_DATABASE_SSL=false` os dois passam (confirmado — inclusive o caminho novo
  do `init` via `SessionManager.create` contra o Postgres real). Fix: comentar
  `NIO_DATABASE_SSL` no `.env` p/ banco local (o `.env.example` já orienta).
- Smoke JSON-RPC do `nio-cli` (server principal): `tools/list` devolve as 7 com
  schema válido, incluindo `nio_profile_get`/`nio_session_list`/`nio_session_activate`.

### Checkpoint (4.0→4.2) — aprovado, seguiu direto pro resto

---

## 2026-08-26 — Sprint 4 fatias 4.3→4.5: `nio_session_create` + `nio_env_*` — SPRINT 4 COMPLETO

Fecha o Sprint 4. As 3 tools restantes + o teste de integração do `SessionManager`.
Suíte **100% verde** de novo (ver nota do `.env` abaixo).

### Fatia 4.3 — `nio_session_create`
`src/tools/session-create.ts` (+ testes). Args `{ name, profile, project_path, ide? }`.
Valida que `project_path` existe. Chama `SessionManager.create` → cria a `Session`
(vira a `active`, arquiva as outras) + materializa o perfil em `sessions.config`.
**Headless**: não escreve `opencode.json`, não provisiona cliente, não faz handoff.
Devolve `{ session, mcps, toolchains_failed, materialize_error, note }` — a `note`
avisa que os MCPs precisam ser registrados no cliente à mão.

### Fatia 4.4 — `nio_env_materialize` + `nio_env_detect_deps`
| Arquivo | Tool |
|---|---|
| `src/tools/env-materialize.ts` (+ testes) | `nio_env_materialize({ session? })` → `SessionManager.materialize` (re-roda o builder na sessão ativa/por-prefixo, reescreve o config). Devolve config + `toolchains_failed` |
| `src/tools/env-detect-deps.ts` (+ testes) | `nio_env_detect_deps({ session?, install? })` → um `DependencyWatcher.tick` na sessão. `install` default `false` (igual `nio deps scan --install`). Devolve scanned/missing/recorded/installed. Fábrica do watcher injetável pra teste |

`sessionErrorResult(err, context?)` ganhou o parâmetro de contexto — cada tool
formata "Falha ao criar a sessão / materializar o ambiente / detectar dependências".

### Fatia 4.5 — Fecho
- 10 tools registradas em `src/tools/index.ts` (4 → 10). Smoke JSON-RPC do
  `nio-cli`: `tools/list` devolve as 10 com schema válido.
- `src/app/session-manager.integration.test.ts` (gated em `NIO_DATABASE_URL`):
  `create` (materialização real do `dba` via EnvironmentBuilder) → `list` →
  `resolve` por prefixo → `activate` → `materialize` → pause → delete, contra o
  Postgres real. **1 pass / 12 asserts**, usuário descartável limpo no `finally`.
- `gen:docs` (README: 10 tools + parágrafo de status reescrito).
- Task 4.7 (registrar o `nio-cli` no Claude Code / OpenCode e round-trip nas
  tools) fica como smoke manual do dono do projeto.

### Nota — `.env` local (fechou as "2 falhas de sempre")
O `.env` estava com `NIO_DATABASE_SSL=true` apontando pro Postgres do Homebrew
(que não faz SSL) — origem das 2 (depois 3) falhas de integração "ambientais"
que vinham aparecendo. Comentado (`# NIO_DATABASE_SSL=true`), alinhado ao
`.env.example`. **Suíte: 310 pass / 1 skip / 0 fail.**

### Estado do Sprint 4
**COMPLETO.** Tasks 4.1-4.6 do doc de transição feitas via `SessionManager` (app
layer nova, base única da CLI e das tools). 4.7 = smoke manual nos clientes.
Restam do roadmap: Sprint 5 (receitas do NIO-SKILLS no wizard) e Sprint 6
(polish + publish 2.0.0).

### Débito conhecido (não-bloqueante)
- `nio_session_create`/`nio_env_materialize` devolvem os `McpSpec[]` como dado —
  quem escreve o `opencode.json` continua sendo só o `nio init` (decisão de
  design: a tool não mexe na config do cliente que a está chamando).
- Teste de integração das tools em si (via JSON-RPC com login real) não existe —
  o `SessionManager` real é coberto pelo integration test; as tools são casca fina.

---

## 2026-08-27 — Sprint 5: Integração NIO-SKILLS (escopo original) — recipes de ambiente

Decisão do dono: manter o escopo original do Sprint 5 (5.1–5.5), **incluindo** o
parser de receitas que eu tinha sugerido descontinuar. Integração
mattpocock/skills fica como melhoria futura (Apêndice do plano).

### 5.5 — TTL no cache de skills
`src/lib/skills-cache.ts`: `ensureSkillsCache()` (start do MCP) agora re-baixa se
`cacheMeta().fetchedAt` > `SKILLS_TTL_MS` (**7 dias**). `nio sync` segue
`force:true`. Pura `isFetchedAtStale(fetchedAt, ttl?, now?)` testada isolada.

### 5.2 — `EnvironmentRecipe` + `RecipeCatalog`
| Arquivo | Papel |
|---|---|
| `src/core/environment.ts` | + `EnvironmentRecipe` (slug/profile/languages/frameworks/toolchainIds/mcpIds/envVars/aliases/notes) + port `RecipeCatalog` (`list(profile?)`, `get(slug)`) |
| `src/adapters/skills/recipe-catalog.ts` (+ teste) | Lê `<skillsDir()>/recipes/*.md` (novo kind no repo NIO-SKILLS, **não** provisionado pros clientes). Reusa `parseFrontmatter` (exportado de `lib/skills.ts`). `profile` inválido → aviso no stderr, pula. `recipes/` ausente / skills não baixadas → `[]` (não quebra) |
| `src/profiles/index.ts` | + `KNOWN_TOOLCHAINS` / `KNOWN_MCPS` (registro por id — deriva dos 6 perfis + n8n) pra resolver os ids da recipe |

Distinta da `LanguageRecipe` do nio-lang (hardcoded, nível-SDK): a
`EnvironmentRecipe` é um preset **do repo**, editável sem release, que **estende**
um perfil fixo (nunca cria perfil — regra da CLAUDE.md). Compõem: recipe declara
`languages`, o `LanguageConfigurator` faz o scaffold.

### 5.3 — Merge no `EnvironmentBuilder` + wizard + threading
| Arquivo | Mudança |
|---|---|
| `src/app/environment-builder.ts` (+ testes) | `build(profile, recipe?)`: toolchains = perfil + recipe (resolvidos em `KNOWN_TOOLCHAINS`); mcps = base + perfil + recipe; languages/frameworks = união; envVars/aliases = `{...perfil, ...recipe}` (recipe vence); `config.extra.recipe = slug`. Id desconhecido → `recipeWarnings[]`, ignora (não gera `opencode.json` quebrado). `BuiltEnvironment` + `recipeWarnings` |
| `src/app/session-manager.ts` (+ testes) | `CreateSessionInput` + `recipe?`; constructor + `RecipeCatalog` (default real, catch → vazio); `create` passa a recipe; `materialize` relê `config.extra.recipe` do catálogo e reaplica (pega mudança de recipe no repo); `MaterializedSession` + `recipeWarnings` |
| `src/cli/commands/init/recipe-step.ts` (novo) | `pickRecipe(profile)` — `select` entre as recipes do perfil + "Nenhuma". Sem recipe → `null` sem perguntar |
| `src/cli/commands/init/index.ts` | `pickRecipe` entre `pickProfile` e `manager.create`; reporta recipe + `recipeWarnings` |
| `src/tools/session-create.ts` (+ testes) | arg `recipe` (slug) → resolve via `RecipeCatalog`; rejeita slug inexistente ou de perfil errado; `recipe_warnings` na saída |
| `src/tools/env-materialize.ts` | `recipe_warnings` na saída |

### 5.4 — `nio sync` fecha o ciclo
- `fetchSkills` já traz `recipes/` (é subdir do zipball) — sem código.
- `src/cli/commands/sync.ts`: após provision, se a sessão ativa tem
  `config.extra.recipe`, oferece `[y/N]` re-materializar (best-effort — sem
  login/banco → silencioso).

### 5.1 — já feito (`fetchSkills`), só confirmado

### Verificação
- `tsc --noEmit` verde. `bun test` **329 pass / 1 skip / 0 fail** (+13 novas:
  skills-cache TTL ×6, recipe-catalog ×7, builder merge ×4, session-manager
  threading ×3, tools ×2).
- Smoke real (`nio init` com `recipes/` no NIO-SKILLS) + integração Postgres:
  passos manuais (gated em login + `NIO_SKILLS_REF`).
- Exemplos de `recipes/*.md` pro repo NIO-SKILLS: em
  `scratchpad/nio-skills-recipes/` (o dono commita lá).

### Fora de escopo (registrado)
- Integração mattpocock/skills — melhoria futura.
- Skills cientes de `Profile` (ligar `Profile` à taxonomia `Selection`) — sprint própria.

### Sprint 5 — COMPLETO. Resta Sprint 6 (polish + publish 2.0.0).

---

## 2026-08-27 — Arquitetura de clientes de IA, Parte A: multi-primário (OpenCode | Codex)

Início da arquitetura nova de clientes (plano faseado: A detecção multi-primário,
B Headroom-proxy, C ladder de failover Qwen/Kimi — ver
`~/.claude/plans/cryptic-cooking-mitten.md`). **Parte A entregue.**

Antes: `handoffToOperator` era `spawn("opencode", [], { stdio: "inherit" })` fixo;
Codex tinha o motor de config no repo mas dormente (`ALL_TARGETS =
[opencodeTarget]`, `CLIENTS = { opencode }`).

### Código
| Arquivo | Mudança |
|---|---|
| `src/lib/client-install.ts` | `CLIENTS` ganha `codex` (`@openai/codex`, bin `codex`) |
| `src/lib/primary-client.ts` (novo, + teste) | `detectPrimaryClient(hint?, isInstalled?)` — PATH + hint (`nio.user.json`) + override `NIO_PRIMARY_CLIENT`; ambos instalados → OpenCode por prioridade. `PrimaryClient = 'opencode'|'codex'` |
| `src/config.ts` | `UserConfig` + `primaryClient?` (hint per-máquina, sempre re-validado); `readUserConfig()` exportado; `writeUserConfig` faz **merge** (não apaga campos) |
| `src/lib/client-configs.ts` | `planCodexUpdate` + `profileMcps` (paridade com `planOpencodeUpdate` — split `command`/`args`/`env` do formato TOML do Codex); `installCodexGlobal` + `profileMcps` + seam de path (`codexGlobalPath`) |
| `src/lib/targets.ts` | `ALL_TARGETS = [opencodeTarget, codexTarget]`; `targetForPrimary(primary)`; `detectConfiguredTargets` checa `~/.codex/config.toml` também |
| `src/lib/autopull.ts` | `pickProvisionTarget('codex')` → `codexTarget` |
| `src/cli/flows/clients.ts` | `ensureCoreClients` → **`resolvePrimaryClient`** (detecta, pergunta se ambos, oferece instalar se nenhum, persiste em `nio.user.json`) |
| `src/cli/commands/init/clients-step.ts` (reescrito) | sai o checkbox de 1 opção; `installPrimaryClient(primary, mcps)` escreve `opencode.json` **ou** `codex/config.toml` |
| `src/cli/commands/init/provision-step.ts` | `resolveProvisionTargets(primary)` (não mais `clientConfigs`) |
| `src/cli/commands/init/index.ts` | `runInitWizard` detecta o primário no início e threada; `handoffToOperator(primary)` spawna `opencode` **ou** `codex`; sem primário → avisa, não falha |
| `src/cli/commands/agent.ts` (novo) + `src/cli.ts` | `nio agent status` — mostra primário detectado, instalados, hint, override. Base pro `next`/`reset`/`tiers` da Parte C |

### Verificação
- `tsc --noEmit` verde. `bun test` **338 pass / 1 skip / 0 fail** (+13 novas:
  primary-client ×10, planCodexUpdate+mcps ×3). `clients-step.test.ts` removido
  (o dispatcher é trivial, coberto pelos testes de `client-configs`).
- Smoke: `nio agent status` (ambos no PATH → OpenCode principal);
  `NIO_PRIMARY_CLIENT=codex` inverte. `installCodexGlobal` gera `config.toml`
  válido com `mcp_servers.nio` + MCPs do perfil (command/args/env separados).
- Smoke pendente (manual): `nio init` com só `codex` no PATH → escreve `~/.codex`,
  provisiona skills traduzidas (`toCodexDocs`), handoff spawna `codex`.

### Próximo
- Checkpoint com o dono → plano detalhado da **Parte B** (Headroom proxy Docker).

---

## 2026-08-29 — Reversão da Parte A: volta ao operador único OpenCode + big-pickle

Decisão do dono: a arquitetura multi-cliente / failover vira **feature futura**. A
modelagem da CLI segue com **um operador fixo — `opencode` + `opencode/big-pickle`**
(a decisão de 24 ago, `ARQUITETURA-CLIENTE-IA.md`). Formalizado na
**[ADR 0004](../adr/0004-operador-ia-unico.md)**.

### O que foi revertido (subconjunto da Parte A em `ffd13c3`)
`git revert ffd13c3` estava fora — o commit carrega também Sprint 4/5
(SessionManager, recipes, tools `nio_session_*`/`nio_env_*`). Reversão cirúrgica
dos 17 arquivos da Parte A:

| Operação | Arquivos |
|---|---|
| `git checkout ffd13c3~1 --` | `client-install.ts`, `targets.ts`, `client-configs.ts` (+ `-install.test`), `autopull.ts` (+test), `config.ts`, `flows/clients.ts`, `init/clients-step.ts` (+ **teste restaurado**, que `ffd13c3` tinha deletado), `init/provision-step.ts` (+test), `ARQUITETURA-CLIENTE-IA.md` (tira o banner "superado") |
| `git rm` | `lib/primary-client.ts` (+test), `cli/commands/agent.ts` |
| edição cirúrgica | `init/index.ts` (só os hunks de cliente — `ensureCoreClients`/`handoffToOperator()` fixo em `opencode`; **mantidos** os hunks de `SessionManager`/`pickRecipe`), `cli.ts` + `scripts/gen-reference.ts` (tira `registerAgentCommand`), `README.md` (seção "Cliente de IA" reescrita) |

### O que **não** mudou
- `NIO_OPERATOR_MODEL = 'opencode/big-pickle'` — byte-idêntico antes/depois de
  `ffd13c3`, escrito por `planOpencodeUpdate`/`installOpencodeGlobal`. Intacto.
- Motor de config do Codex (`codexTarget`, `toCodexDocs`, `planCodexUpdate`,
  `installCodexGlobal`, `claudeTarget`) — **fica dormente no repo**, como estava
  antes de `ffd13c3` (desde 27 jul). Não apagado — a feature futura reaproveita.
- Todo o resto de `ffd13c3` (Sprint 4/5) e `fa3cefe` inteiro.
- Bônus: `init/provision-step.test.ts`, quebrado no HEAD (importava `ClientChoice`,
  removido em `ffd13c3`), volta a compilar.

### Registro da feature futura
- **`docs/adr/0004-operador-ia-unico.md`** (novo).
- **`docs/v2/ARQUITETURA-CLIENTES-MULTI-FUTURO.md`** (novo) — o desenho das Partes
  A/B/C, de `~/.claude/plans/cryptic-cooking-mitten.md`, com nota de que a Parte A
  já foi feita/revertida (o diff de `ffd13c3` é o guia pra retomar).
- A entrada de 27 ago acima **fica** — é o registro histórico da Parte A.

### Verificação
- `bunx tsc --noEmit` verde. `bun test` **329 pass / 1 skip / 0 fail** (−9 vs. o
  baseline de 338: saíram `primary-client.test` ×10 e 3 testes de
  `planCodexUpdate+profileMcps`; voltou `clients-step.test`).
- `grep -rn "primary-client\|PrimaryClient\|resolvePrimaryClient\|targetForPrimary\|NIO_PRIMARY_CLIENT\|registerAgentCommand" src scripts` → vazio.
- `bun src/cli.ts --help` lista `agents` (plural, lista subagentes), **não** `agent`.
- Smoke do `nio init` (gated em login+Postgres) fica manual: wizard não pergunta
  "OpenCode ou Codex"; handoff spawna `opencode`.

---

## 2026-08-29 — Camada Docker: `nio docker *` (MCP Gateway + Portainer + Swarm)

Feature nova ([ADR 0005](../adr/0005-camada-docker.md), plano aprovado). Grupo
`nio docker` híbrido: wrapper determinístico sobre `docker` + handoff pro operador
de IA via **Docker MCP Gateway**, com Portainer pra visibilidade e Swarm no
`cluster`. Ver `docs/v2/ARQUITETURA-DOCKER.md`.

### Código
| Arquivo | Papel |
|---|---|
| `docker/docker-compose.yml` + `dev:docker` | Infra NIO (espelha `kong/`): `nio-mcp-gateway` (`docker/mcp-gateway`, `--transport=streaming --port=8811 --servers=docker`, docker.sock, `127.0.0.1:8811`) + `nio-portainer` (`portainer-ce:lts`, `:9443`/`:8000`). Roda sem Docker Desktop. |
| `src/lib/docker.ts` (+ test) | `DOCKER_MCP_URL`/`PORTAINER_URL`/`CLUSTER_STACK`, `infraComposePath()`, `dockerAvailable()` (`docker` + `docker compose version`), `swarmActive()`, `portOpen()` (TCP puro — Portainer é TLS self-signed), `unreachableDocker()`. |
| `src/core/docker.ts` | Port `DockerGateway` (contrato **nunca lança**, `DockerResult { status }`), union types (`ComposeAction`, `ClusterAction`), `RunSpec`, `ClusterState`. |
| `src/adapters/docker/docker-gateway.ts` (+ test) | Impl via `spawnSync('docker', [...])` **sem shell**. Arg-builders puros exportados (`composeArgs`/`runArgs`/`stackDeployArgs`/`serviceScaleArgs`) — testados deep-equal. |
| `src/app/docker-manager.ts` (+ test) | Prompt builders (`buildDebugPrompt`/`Orquest`/`Cluster`, preâmbulo âncora), `runOperator()` → `opencode run --model opencode/big-pickle`, `collectDebugContext()`, `parseStackServices`/`parseScaleArg`, `read`/`persistClusterState` → `config.extra.docker.cluster`. |
| `src/cli/commands/docker.ts` (+ registro em `cli.ts` + `gen-reference.ts`) | `toolkit up\|down\|status`, `portainer [--url]`, `compose <up\|down\|restart\|ps\|logs> [svc]`, `create` (wizard/flags), `debug [container] [--json]`, `orquest [instr] [--dry-run]`, `cluster <up\|down\|status\|scale>`. |
| `src/core/environment.ts` | `McpSpec` ganhou `url?` (MCP remoto). |
| `src/lib/client-configs.ts` (+ test) | `opencodeMcpEntry` branch `type: 'remote'`; novo `upsertOpencodeMcp(spec, {remove?, path?})` — funde/desabilita **uma** entrada no `opencode.json` com `.bak`. |
| `src/profiles/mcps.ts` / `index.ts` | + `dockerGatewayMcp = { id: 'docker', url: DOCKER_MCP_URL }`. **Fora** do `BASE_MCPS` (opt-in via `toolkit up`); em `KNOWN_MCPS`. |

### Decisões
- **Híbrido:** `compose`/`create`/`toolkit`/`portainer` = determinístico;
  `debug`/`orquest`/`cluster` = operador (`opencode run`, `stdio: inherit`).
- **MCP Gateway = container NIO-gerenciado** (`nio docker toolkit up` sobe +
  registra no `opencode.json`), transport `streaming` em `127.0.0.1:8811/mcp`.
- **`cluster` = Swarm** (`stack deploy nio-cluster`). A NIO **valida** contra
  `docker stack services` — não confia na saída do operador — e persiste em
  `config.extra.docker.cluster` (sem migration).
- Contrato "nunca lança" no `DockerGateway`; `spawnSync` sem shell em tudo.

### Verificação
- `bunx tsc --noEmit` verde. `bun test` **349 pass / 1 skip / 0 fail** (+20:
  arg-builders ×8, docker-manager ×12, `upsertOpencodeMcp` ×2 — menos overlap).
- `bun src/cli.ts docker --help` lista as 7 subárvores. Erros sem Docker/login/
  ação inválida → pt-BR acionável, exit 1.
- **Smoke com Docker real** (manual): `nio docker toolkit up` → containers +
  `mcp.docker` no `opencode.json`; `nio docker compose up -f …`; `nio docker debug
  <ctr>`; `nio docker cluster up "api + redis"` → `docker stack ls` + estado
  persistido; Portainer em `:9443`.

### Débito / a confirmar no 1º uso real
- Entrypoint da imagem `docker/mcp-gateway` + nome exato do server (`--servers=docker`).
- Bootstrap headless do admin do Portainer (hoje: 1º acesso manual).
- `opencode run` carregar MCP `type: 'remote'` — fallback: handoff interativo.
- Portainer Agent (Swarm multi-nó) — fora do escopo v1.

---

## 2026-08-30 — 2º fator no login (SMS OTP direto no gateway) — fecha a v1 da CLI

Feature nova ([ADR 0006](../adr/0006-2fa-sms-otp.md), [spec 0004](../specs/auth/0004-login-2fa-sms-otp.md),
plano aprovado). A coluna `user_cli.auth_2` finalmente é usada: login com 2º
fator por **SMS + OTP de 6 dígitos**, mensageria **direta no `nio-gateway`** (sem
broker/fila), com **10 códigos de backup** de uso único como caminho alternativo
(exigência NIST SP 800-63B). Supera a spec 0003 (Twilio Verify) e o pivô TOTP de
`diagrama/ARCHITETURA-2FA-TOTP.md`.

### Decisões travadas
- **Mensageria = serviço direto no gateway.** O `POST /login` gera o OTP, envia o
  SMS inline e responde `2fa_required`; sem worker, sem cron, sem `amqplib`/`bullmq`.
- **SMS via adapter HTTP genérico** — `SMS_ENDPOINT_URL` + `SMS_AUTH_HEADER` (linha
  `Nome: valor`) + `SMS_BODY_TEMPLATE` (JSON com `{to}`/`{text}`/`{from}`) + `SMS_FROM`
  opcional. Pluga qualquer provedor por env. **Sem prefixo `NIO_`** (segredo da
  equipe, regra do `JWT_SECRET`). Faltou url/template → `{ status: 'skipped' }` e o
  gateway responde 503 "2FA não configurado".
- **Estado do OTP é nosso** — tabela `login_challenges` (sem Twilio, não há serviço
  externo guardando geração/TTL/tentativas). `code_hash` = **HMAC-SHA256(código,
  JWT_SECRET)**; o código puro nunca é persistido nem logado (ANPD Res. 15/2024).
  TTL **5 min**, **3 tentativas**, uso único (`consumed_at`).
- **Códigos de backup:** 10 no `enable-2fa`, alfabeto sem confusáveis, hash
  **argon2id** (reusa `hashPassword` — zero dep nova), juntos por `|`, entrada vira
  `[USED]` ao consumir. Mostrados 1×. Após 3 OTP errados o login exige um backup.
- **Trilha auditável** = stderr estruturado no gateway (`logAuthEvent`,
  `event: 'auth_attempt'`), nunca senha/OTP. Tabela `login_attempts` fica de follow-up.

### Schema — `db/migrations/0004_login_2fa.sql` (+ `db/schema.sql` em lockstep)
- `user_cli` += `phone TEXT` (E.164, `NULL` = sem 2FA), `backup_codes TEXT`.
- Nova tabela `login_challenges` (`id UUID`, `user_id → user_cli ON DELETE CASCADE`,
  `purpose CHECK ('login','enable_2fa')`, `code_hash`, `channel CHECK ('sms')`,
  `attempts`, `expires_at`, `consumed_at`, `created_at`), índices por `user_id` e
  `expires_at`, `COMMENT ON`.
- **Aplicada manualmente no banco de dev local** (`postgres://hugo@localhost/nio_cli`).
  Qualquer outro banco (CI, colega, produção) precisa rodar a migration.

### Código
| Arquivo | Papel |
|---|---|
| `src/core/types.ts` | `UserCli` += `phone`; entidade `LoginChallenge` + `ChallengePurpose`. |
| `src/core/repositories.ts` | `UserRepository` += `findById`/`enable2fa`/`disable2fa`/`updateBackupCodes`/`getBackupCodes`; novo port `LoginChallengeRepository`. |
| `src/adapters/pg/user-repository.ts` (+ test) | `phone`/`backup_codes` no `UserRow`/`COLS`; `mapUserRow` expõe `phone` mas **nunca** `backup_codes` na entidade; 5 métodos novos. |
| `src/adapters/pg/login-challenge-repository.ts` (+ test do mapper) | molde do `dependency-event-repository`; `create` limpa expirados + desafio ativo do usuário em `withTransaction`. |
| `src/lib/otp.ts` (+ test) | `generateOtp` (`randomInt`), `hashOtp` (HMAC), `verifyOtp` (`timingSafeEqual`, nunca lança em hex inválido), `isOtpFormat`. |
| `src/lib/backup-codes.ts` (+ test) | `generateBackupCodes` (10, argon2id), `verifyBackupCode` (índice ou −1, case-insensitive), `markUsed`, `countRemaining`, `isBackupCodeFormat`. |
| `src/core/messaging.ts` | Port `SmsSender { send(to, text): Promise<SmsResult> }`, contrato **nunca lança** (`status: 'sent'\|'skipped'\|'failed'`). |
| `src/adapters/sms/http-generic.ts` (+ test) | `createHttpSmsSender`: `parseAuthHeader`, `renderBody` (JSON-escapa `{text}`), `fetch` com `AbortSignal.timeout(10s)`, não-2xx → `failed`. |
| `src/gateway/services/login.ts` (+ test reescrito) | `issueSession(user)` extraído; `login` com branch `auth_2` (gera OTP + `sms.send`); `verifyLogin(challengeId, code, type)` (OTP → 3 tentativas → exige backup; backup → `markUsed`); `maskPhone`, `challengeUsable`. |
| `src/gateway/services/security.ts` (novo) | `startSecurityChallenge`, `confirmEnable2fa`, `disable2fa`, `regenerateBackupCodes`, `status` — tudo amarrado ao `userId` do Bearer. |
| `src/gateway/edge-filter.ts` | `logAuthEvent(ctx, result, meta)` — stderr JSON. |
| `src/gateway/index.ts` | rotas `POST /verify-2fa` e `/security/*`; `requireAuth` (Bearer → 401); `TOKEN_REQUIRED` cobre login/logout/verify-2fa/`/security/`. |
| `src/lib/gateway-client.ts` | `GatewayLoginResult` union (`done` \| `2fa_required`); `gatewayVerify2fa`; `gatewaySecurity` (status/enable/confirmEnable/challenge/disable/regenerateBackupCodes). |
| `src/cli/commands/auth.ts` | `resolveSecondFactor` — loop de prompt do código SMS, cai pro código de backup em `requiresBackupCode`. |
| `src/cli/commands/security.ts` (novo, + `cli.ts` + `gen-reference.ts`) | `nio security enable-2fa\|disable-2fa\|regenerate-backup-codes\|status` (`--json`); backup codes num `box()`. |
| `kong/kong.yml` | rotas `nio-gateway-verify-2fa` e `nio-gateway-security` com `rate-limiting` (10/min). |
| `.env.example` | `SMS_ENDPOINT_URL`/`SMS_AUTH_HEADER`/`SMS_BODY_TEMPLATE`/`SMS_FROM` (comentadas). |

### Verificação
- `bunx tsc --noEmit` verde. `bun test` **373 pass / 1 skip / 0 fail** (+24 vs. o
  baseline de 349: `otp`, `backup-codes`, `http-generic` sms, mapper do
  `login-challenge`, `login.ts` — `issueSession`/branch `auth_2`/`verifyLogin`
  OTP+backup+expirado+3-tentativas — com repos/sender fake).
- `bun src/cli.ts security --help` lista `enable-2fa`/`disable-2fa`/`regenerate-backup-codes`/`status`.
- `bun run gen:docs` → tabela COMMANDS do README inclui a subárvore `security`.
- Nenhum log (stderr do gateway) inclui o OTP ou a senha em texto puro — só
  `event: 'auth_attempt'` com `result`/`name`/`userId`/`reason`.

### Smoke manual (pendente — precisa do `nio-gateway` no ar + `SMS_ENDPOINT_URL`)
- `nio security enable-2fa` → SMS → confirma → 10 códigos no box.
- `nio login` (user `auth_2=true`) → SMS → código → sessão salva.
- código errado 3× → prompt "código de backup" → backup válido → sessão.
- `SMS_ENDPOINT_URL` ausente → "2FA não configurado no servidor".
- `nio security disable-2fa` / `status`.

### Docs
- [ADR 0006](../adr/0006-2fa-sms-otp.md) + [spec 0004](../specs/auth/0004-login-2fa-sms-otp.md) (novos).
- Spec 0003 → `status: superseded` (`superseded_by: 0004`); banner no topo.
- `diagrama/ARCHITETURA-2FA-TOTP.md` → banner "não é o caminho escolhido".
- `docs/v2/ARQUITETURA-GATEWAY.md` → banner + item 7 na linha do tempo (Twilio →
  HTTP genérico, estado do OTP nosso).
- `README.md` → seção "2º fator (SMS)".

---

## 2026-08-30 — Limpeza de arquitetura pré-publicação (0.2.0)

Antes de subir o pacote, faxina do resíduo v1 e reorganização do `src/` pra
ficar legível. 6 commits (`21ef0a0`..`527bbaf`).

### Removido (código morto)
- `InvestigationGateway` + `src/adapters/postgres/` + `src/core/{ports,types}.ts`
  (o antigo) — scaffolding de investigação read-only dual-IP, nunca ligado.
- `src/lib/{require-config,active-project}.ts` — binding de projeto NOS v1.
- `workers/edge-filter/` — Cloudflare Worker do gateway v1 (fora do build).
- `src/constants.ts` — `SESSION_FILE` foi pra `session-store.ts`.

### Removido (docs obsoletos)
- specs `auth/0001-0003`, `investigation/`, `rebrand/`; `adr/0001`
- `docs/{PLANO-EXECUCAO,ROADMAP,diagnostico-2026-07-27}.md`, `roadmap-*.html`,
  `NIO-CLI-Transicao-v1-v2.md`, `docs/v2/TASK-*.md`
- `diagrama/` inteiro (mermaids do gateway OAuth/PKCE v1)

### Reorganizado
- `docs/v2/` → `docs/arch/` (ARQUITETURA-*) + `docs/PROGRESSO.md`
- `src/core/session.ts` → `src/core/types.ts` (é o arquivo de entidades do
  domínio inteiro; os outros de `core/` já eram ports fatiados por domínio)
- `src/lib/` (44 soltos) → 12 na raiz + `lib/{clients,deps,provision,skills,exec,auth}/`
- `src/spinner.ts` → `src/lib/spinner.ts`
- `CLAUDE.md` "Arquitetura (hexagonal)" reescrita pra estrutura real

### Verificação
`bunx tsc --noEmit` verde. `bun test` **368 pass / 1 skip / 0 fail** (era 379 —
saíram 11 testes da investigação). `bun run build` → 4 bins. `nio docs`/`config
check`/`debug` OK. `grep` por refs mortas (`docs/v2/`, `InvestigationGateway`,
`workers/edge-filter`, `core/session.js`) → limpo (fora deste log).

---

## 2026-08-31 — Client de IA embutido: Headroom obrigatório + terminal na IDE (Fase 1)

ADR [0007](adr/0007-headroom-proxy-obrigatorio.md). O `nio init` terminava abrindo
a IDE numa janela e a TUI do OpenCode noutra tela, sem camada entre agente e LLM.

### Spike (gate) — PASSOU
- `ghcr.io/headroomlabs-ai/headroom:latest` (v0.37.0). Entrypoint já é `headroom proxy`
  — `command` passa só flags (`--host 0.0.0.0 --port 8787`).
- `OPENAI_TARGET_API_URL=https://opencode.ai/zen/v1` → roteia `/v1/chat/completions`
  e `/v1/responses` pro OpenCode Zen; `Authorization` do OpenCode passa transparente
  (Headroom sem key própria). Health: `GET /livez`.
- `opencode.json` com `provider.opencode.options.baseURL = http://127.0.0.1:8787/v1`
  → `opencode run` passou pelo Headroom (`api_requests: 1`) e o Zen respondeu.
- `opencode/big-pickle` segue válido (catálogo Zen, 94 modelos).

### O que entrou
- **`headroom/docker-compose.yml`** (shipado no `package.json` `files`) + `dev:headroom`.
- **`src/lib/headroom.ts`** — `HEADROOM_PORT/URL`, `headroomComposePath()`,
  `headroomHealthy()` (`portOpen`), `ensureHeadroomRunning()` (compose up + espera
  ~30s), `headroomCompose()`.
- **`src/app/ai-client.ts`** — `launchAiClient({cwd, prompt?})`: Headroom (obrigatório,
  `HeadroomRequiredError`) → `installOpencodeGlobal(…, HEADROOM_URL)` → `spawn opencode`.
  Seams de teste (`ensureHeadroom`/`spawnFn`/`isInstalled`).
- **`src/lib/clients/client-configs.ts`** — `planOpencodeProvider(existing, baseURL)` +
  `planOpencodeUpdate(…, headroomUrl?)` + `installOpencodeGlobal(…, headroomUrl?)`.
- **`src/lib/ide-tasks.ts`** — `writeIdeAutostartTask(projectPath)`: merge não-destrutivo
  de `.vscode/tasks.json` (task `NIO`, `runOn: folderOpen`, `command: nio ai`) +
  `settings.json` (`task.allowAutomaticTasks: on`). Gitignora só quando cria o `tasks.json`.
- **`src/cli/commands/ai.ts`** — `nio ai` (sessão ativa → `launchAiClient`) + `nio ai status`.
- **`src/cli/commands/init/index.ts`** — `openSessionIde`+`handoffToOperator` → `handoffToSession(session)`:
  IDE → grava a task + abre a IDE + para (o terminal integrado sobe o `nio ai`);
  terminal/other ou IDE indisponível → `nio ai` no terminal atual.
- **`handoff.ts`** / **`docker-manager.ts` `runOperator`** / **`onboarding.ts` `handleReady`** /
  **`nio open`** — passam por `launchAiClient` / `handoffToSession`.
- **`nio docker headroom {up,down,status}`**; **`nio debug`** ganhou a checagem do Headroom.
- Docs: ADR 0007, notas em `ARQUITETURA-GATEWAY.md`/`ARQUITETURA-DOCKER.md`/`ARQUITETURA-CLIENTE-IA.md`,
  Parte B de `ARQUITETURA-CLIENTES-MULTI-FUTURO.md` marcada FEITA, novo
  `ARQUITETURA-CLIENTE-TUI-FUTURO.md` (Fase 2), README, `nio docs`, `.env.example`, CLAUDE.md.

### Verificação
`bunx tsc --noEmit` verde. `bun test` **394 pass / 2 skip / 0 fail** (+12). `bun run build`
(4 bins + `headroom/` no pacote). `bun run gen:docs` (README ganha `ai`).

### Fase 2 (parkeada)
Interface NIO em OpenTUI ↔ `opencode serve` via `@opencode-ai/sdk` — plano próprio.
