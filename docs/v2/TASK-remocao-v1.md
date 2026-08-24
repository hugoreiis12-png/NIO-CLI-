# Tarefa — Desligar e remover o v1 (NOS/Supabase) do NIO-CLI

> Para o agente que pegar esta tarefa: leia inteiro antes de tocar em código. O
> objetivo final é "nada de v1 é usado" (decisão do dono do projeto, 23 ago
> 2026), mas a execução é **cirúrgica e incremental** — cada passo termina com
> `bunx tsc --noEmit` limpo e `bun test` verde antes do próximo. Não faça um PR
> único gigante.

## Contexto

O v2 (orquestrador de ambientes) está sendo construído **ao lado** do v1
(cliente de tarefas/ponto do NOS, sobre Supabase), não substituindo-o de
uma vez. Estado em **24 ago 2026** (atualizado — ver `docs/v2/PROGRESSO.md`
pro histórico completo):

- **Já migrado pra v2 e em uso:** schema Postgres (`db/schema.sql`), pool
  (`src/adapters/pg/client.ts`), hashing de senha (`src/lib/password.ts`),
  `UserRepository`, `SessionRepository` (CRUD de `sessions`/ambiente — pronto
  no backend, ainda sem CLI/tool que o exponha), `AuthSessionRepository` +
  Gateway JWT (`src/gateway/config.ts`, `services/login.ts`,
  `middleware/auth.ts` — emite/valida token, tabela `auth_sessions`).
- **As 16 tools v1 (tasks/sprints/alocação) já foram removidas** de
  `src/tools/index.ts` — só sobram as 4 tools genéricas de execução
  (`nio_plan`, `nio_exec_status`, `nio_delegate_exec`, `nio_validate_plan`).
  `src/session-factory.ts` (só suportava backend `supabase`) já foi apagado.
- **Dois mecanismos de sessão de login coexistindo, temporariamente**: o
  antigo (`user_cli.token_session`, escrito por `UserRepository.setSessionToken`)
  e o novo (JWT + `auth_sessions`). A tarefa mais recente (em andamento nesta
  data) troca `cli/commands/auth.ts` e `mcp-server.ts` pra usar só o JWT — ver
  "Passo 0" abaixo, é a **primeira coisa a conferir** antes de tocar no resto.
- **Ainda 100% v1** (sem uso pelos caminhos ativos, mas presente no repo):
  `src/adapters/supabase/*`, `src/auth.ts`, `src/database.types.ts`,
  `@supabase/supabase-js` + script `gen:types` no `package.json`.

Esta tarefa é sobre desligar e remover o que ainda é v1 **e** unificar os
dois mecanismos de sessão em um só, sem quebrar o que já está em produção.

## Princípio orientador

1. **De fora pra dentro.** Comece pelos consumidores (tools, comandos de CLI),
   só depois toque nas portas/adapters que eles chamam. Remover uma
   dependência compartilhada antes de quem a usa quebra o build no meio do
   caminho.
2. **`tsc --noEmit` e `bun test` verdes a cada commit.** Se um passo deixa o
   projeto num estado que não compila, ele está grande demais — quebre em
   passos menores.
3. **Não adivinhe se algo é v1 ou genérico — confira o import.** Vários
   módulos em `lib/` e `tools/` **parecem** do domínio de tarefas mas não
   são (ver tabela "Manter" abaixo). Removê-los por engano tira funcionalidade
   do v2 que não tem nada a ver com Supabase.
4. **`docs/v2/PROGRESSO.md` é o log.** Registre cada etapa concluída lá, no
   mesmo formato das entradas existentes (data, o que mudou, como verificar).

## Passo 0 — Unificar sessão de login (fazer ANTES do resto)

**Pré-requisito**: `cli/commands/auth.ts` e `mcp-server.ts` já devem estar
usando o Gateway JWT (`gateway/services/login.ts`/`middleware/auth.ts`) em
vez do fluxo antigo — se `nio login` ainda escreve em `user_cli.token_session`,
**pare aqui e confirme isso primeiro** (ver `docs/v2/PROGRESSO.md`, entrada
mais recente). Removendo o mecanismo antigo antes do novo estar validado em
produção, o login quebra sem fallback.

Com o JWT confirmado funcionando (login → `nio whoami` mostra `sessionId`/
`expiresAt` → MCP server autentica), então:

1. Confirmar que nada mais chama `UserRepository.setSessionToken` nem lê
   `UserCli.tokenSession`:
   ```bash
   grep -rn "setSessionToken\|tokenSession\|token_session" src --include="*.ts"
   ```
2. Remover `setSessionToken` da porta (`core/repositories.ts`) e da
   implementação (`adapters/pg/user-repository.ts`).
3. Remover o campo `tokenSession`/`token_session` da entidade `UserCli`
   (`core/session.ts`) e do `mapUserRow`.
4. Migration nova (`db/migrations/0003_drop_token_session.sql`): `ALTER TABLE
   user_cli DROP COLUMN token_session;` + `DROP INDEX idx_user_cli_token;` +
   atualizar `db/schema.sql` (fonte da verdade) pra refletir a coluna já
   removida.
5. `bunx tsc --noEmit` + `bun test` verdes; registrar em `PROGRESSO.md`.

Resultado: só `auth_sessions` (JWT) como mecanismo de sessão de login —
multi-dispositivo de verdade, sem os dois sistemas coexistindo.

## Inventário classificado

### Remover (puro v1 — Supabase/NOS, sem uso no v2)

| Caminho | Papel | Observação |
|---|---|---|
| `src/adapters/supabase/*` (`client.ts`, `gateway.ts`, `context-gateway.ts`, `task-gateway.ts` (+`.test.ts`), `allocation-gateway.ts`, `analytics-gateway.ts`) | Adapter Supabase inteiro | Nada no v2 importa daqui hoje, exceto os módulos listados em "Migrar/Adaptar" abaixo |
| ~~16 tools de tasks/sprints/alocação~~ | ✅ **Já removidas** (24 ago) | `src/tools/index.ts` só tem as 4 tools genéricas hoje |
| `src/database.types.ts` | Tipos gerados pelo Supabase CLI (`supabase gen types`) | Gerado, não escrito à mão — remover junto com o script que o gera |
| `src/auth.ts` (+ `src/auth.test.ts`) | Fluxo PAT→JWT do Supabase (`nio login <pat>` antigo) | **Já substituído** por `cli/commands/auth.ts` v2. Confirme que nada mais importa daqui (rodar o grep da seção "Como verificar" abaixo) antes de apagar |
| `package.json`: dependência `@supabase/supabase-js`, script `gen:types` | — | Remover só depois que todo o resto desta tabela já foi removido (senão `tsc` quebra primeiro) |
| `src/constants.ts`: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `TOKEN_EXCHANGE_URL`, `CREDENTIALS_DIR`, `CREDENTIALS_FILE`, `PAT_REGEX` | Constantes só usadas pelo `auth.ts` v1 | `brand.ts` também tem `supabaseUrl`/`supabaseAnonKey`/`patPrefix` — avaliar se sobra alguma razão pra mantê-los lá depois que `auth.ts` sumir |

### Migrar/Adaptar (hoje importam de Supabase, mas a *função* ainda faz sentido no v2)

| Caminho | O que tem de v1 | O que fazer |
|---|---|---|
| `src/lib/project-context.ts` | Importa `DbClient` de `adapters/supabase/client.js` e `ExchangeResult` de `auth.js`; todo o shape (`ProjectContextRepository`, `..Member`, etc.) é o domínio NOS (repos, membros, sprints) | Provavelmente morre junto com o domínio de projeto/task — mas confirme que `cli/commands/init/project-step.ts` (que o usa) não vira, antes, uma peça do wizard de perfil do v2. Ver linha abaixo |
| `src/cli/commands/init/project-step.ts`, `src/cli/commands/init/auth-step.ts`, `src/cli/commands/init/index.ts` | O wizard `nio init` inteiro hoje faz "vincular `nio.json` a um projeto do NOS" — isso não existe no domínio v2 (que é sessão + perfil, não projeto+repo do NOS) | **Não é uma remoção mecânica.** É redesenho: o `nio init` do v2 deveria rodar o wizard de perfil (`Profile`) e criar uma `Session`, não pedir login Supabase nem projeto do NOS. Tratar como uma sub-tarefa de design própria, não só "apagar" |
| `src/lib/telemetry.ts` | Importa só o **tipo** `DbClient` de `adapters/supabase/client.js` (pra tipar o client usado em `track()`) | Provavelmente basta trocar a assinatura pra receber o pool `pg` ou um client mais neutro — investigar se telemetria ainda faz sentido no v2 e, se sim, apontar pra onde vai gravar (Postgres `nio_cli`? outro lugar?) |
| ~~`src/session-factory.ts`~~ | ✅ **Já apagado** (24 ago) | Só tinha o `case 'supabase'`; MCP tools v2 falam direto com os repositórios, como o `cli/commands/auth.ts` já fazia |
| `src/mcp-server.ts` | ✅ **`authenticateSession()` já não usa mais Supabase** — hoje lê `lib/session-store.ts` | 🟡 Mas está no meio de uma segunda troca (fluxo antigo `token_session` → JWT/`auth_sessions`) — ver "Passo 0" acima antes de considerar este item resolvido |

### Resolvido — não é v1, mas está superseded (decisão de 23 ago 2026)

| Caminho | Situação |
|---|---|
| `src/gateway/server.ts`, `sessions.ts`, `pkce.ts`, `authorize-store.ts`, `authorize-page.ts`, `traceability.ts`, `types.ts` | OAuth 2.0 + PKCE self-asserted **sem Supabase** — não é v1. A spec `0002-cli-native-login.md` que os originou está `status: superseded`; o login real do v2 acabou sendo **senha + JWT** (`gateway/services/login.ts`, `middleware/auth.ts`, construídos do zero em 23/24 ago). **A especulação de reuso não se confirmou** — o Gateway JWT novo não importa nada destes arquivos. São candidatos reais a remoção agora (confirme com o grep abaixo antes de apagar) |
| `workers/edge-filter/` | Cloudflare Worker companion do Gateway acima, mesma situação — órfão, sem consumidor. A spec 0003 ainda cita um "Edge Filter" no desenho, mas como peça **escrita à mão** dentro de `src/gateway/`, não necessariamente este Worker. Confirmar com o dono do projeto antes de apagar (é a única entrada desta tabela que ainda pede confirmação humana, não é mecânica) |

```bash
# Confirma que nada do Gateway novo importa os arquivos órfãos acima:
grep -rln "gateway/server\.js\|gateway/sessions\.js\|gateway/pkce\.js\|gateway/authorize-\|gateway/traceability\.js\|gateway/types\.js" src --include="*.ts" | grep -v "gateway/pkce.ts\|gateway/sessions.ts\|gateway/authorize-\|gateway/traceability.ts\|gateway/types.ts\|gateway/server.ts"
```

### Avaliar antes de decidir (não é claramente v1, mas também não é claramente v2)

| Caminho | Por quê está em dúvida |
|---|---|
| `docs/adr/0002-perfil-como-grupo.md`, `0003-gateway-auth-dedicado.md` | Documentação — não apagar código sem revisar se o ADR correspondente precisa de uma nota de "superado por X" |
| `README.md`, `docs/specs/*` (`auth/`, `investigation/`, `plan/`, `exec/`, `rebrand/`) | Documentam uma mistura de v1 e v2; `README.md` em particular ainda descreve a tabela de tools majoritariamente v1 (é **gerada** via `bun run gen:docs` a partir de `brand.ts` + tools registradas — depois de remover as tools v1, rodar esse script de novo em vez de editar `README.md` a mão) |

### Manter (parece v1 à primeira vista, mas é genérico — confirmado por leitura de import)

Não remover — servem tanto v1 quanto v2, sem dependência de Supabase:

- `src/tools/plan.ts`, `validate-plan.ts`, `delegate-exec.ts`, `exec-status.ts` — delegam a um engine de execução externo (`lib/exec-delegate.ts`, `lib/plan-delegate.ts`, `lib/exec-engines.ts`); zero import de `adapters/supabase` ou `Gateway`.
- `src/lib/skills.ts`, `skill-serve.ts`, `skills-cache.ts`, `rules.ts`, `sections.ts`, `hooks.ts`, `provision*.ts`, `client-configs*.ts`, `dependencies.ts`, `dependency-install.ts`, `file-merge.ts`, `harness.ts`, `cowork-extension.ts`, `autopull.ts`, `patterns.ts`, `duration.ts`, `colors.ts`, `prompts.ts`, `require-config.ts`, `targets.ts` — infraestrutura de provisionamento/skills/CLI, sem vínculo de domínio.
- `src/cli/commands/sync.ts`, `skills.ts`, `clean.ts`, `exec.ts`, `plan.ts`, `validate-plan.ts`, `completion.ts` — comandos de CLI genéricos.
- `src/cli/commands/init/clients-step.ts`, `provision-step.ts` — passos do wizard que escolhem cliente de IA / provisionam arquivos, sem tocar em Supabase.
- `src/core/session.ts`, `src/core/repositories.ts`, `src/adapters/pg/*`, `src/gateway/config.ts`, `src/gateway/services/`, `src/gateway/middleware/` — é o v2, óbvio, mas citado aqui pra registrar que **não é candidato a remoção**, é o destino.

## Ordem sugerida (atualizada 24 ago — passos 1-2 e 5 originais já concluídos)

0. ~~Passo 0 (unificar sessão)~~ — ver seção própria acima, é pré-requisito
   pra tudo daqui pra baixo que toca `mcp-server.ts`/`user_cli`.
1. Apagar `src/adapters/supabase/*.ts` — nesse ponto só devem sobrar erros de
   `tsc` em `project-context.ts`, `telemetry.ts`, `cli/commands/init/*` (a
   tabela "Migrar/Adaptar" — `session-factory.ts` e o `mcp-server.ts` antigo
   já não estão mais na lista, foram resolvidos).
2. Resolver `telemetry.ts` (trocar o tipo do client) e decidir o destino de
   `project-context.ts` + o wizard `init` (provavelmente uma sub-tarefa
   separada de design, não mecânica — ver "Riscos conhecidos").
3. Apagar `src/auth.ts` (+ teste) e as constantes órfãs em `constants.ts`.
4. Tirar `@supabase/supabase-js` do `package.json` e o script `gen:types`;
   apagar `src/database.types.ts`.
5. Confirmar e apagar os arquivos órfãos de `src/gateway/*` (spec 0002 —
   `server.ts`, `sessions.ts`, `pkce.ts`, `authorize-*.ts`, `traceability.ts`,
   `types.ts`) e decidir o destino de `workers/edge-filter/` com o dono do
   projeto.
6. Rodar `bun run gen:docs` pra regenerar a tabela de tools do `README.md`.
7. Atualizar `docs/v2/PROGRESSO.md` com o resumo da limpeza.

## Como verificar que nada ficou pra trás

```bash
# Depois de cada etapa:
bunx tsc --noEmit
bun test

# Antes de apagar um arquivo específico, confirme que nada mais importa dele:
grep -rln "from '\.\./\.\./auth\.js'\|from '\.\./auth\.js'\|adapters/supabase" src --include="*.ts"

# No final, não deve sobrar nenhuma menção:
grep -rln "supabase" src package.json --include="*.ts" -i
```

## Riscos conhecidos

- **`nio init` fica sem função clara** assim que `project-step.ts`/
  `auth-step.ts` saírem — não é seguro só apagar o comando; ele precisa virar
  o wizard de perfil do v2 (`EnvironmentBuilder`/escolha de `Profile`, que
  ainda não existe em código nenhum). Tratar como funcionalidade a
  **redesenhar**, não a remover.
- **`docs/adr/0001-nio-readonly-dual-ip.md`** e o `InvestigationGateway`
  (`core/ports.ts`, `adapters/postgres/*`) usam Postgres direto mas são um
  propósito **diferente** do `UserRepository`/`sessions` (investigação
  read-only dual-IP, não é o mesmo domínio) — não confundir os dois ao mexer
  em `adapters/postgres/` vs `adapters/pg/`.
- Este documento foi atualizado em 24 ago 2026 (commits até `c2aaa8b` — v1
  tools removidas, `SessionRepository`, `AuthSessionRepository`/Gateway JWT).
  Se o código já andou desde então (em especial o Passo 0, que pode já estar
  concluído por quem ler isto depois), confira os imports de novo antes de
  seguir a tabela cegamente — é o mesmo aviso de sempre, só que agora é a
  segunda vez que este documento fica pra trás do código real.