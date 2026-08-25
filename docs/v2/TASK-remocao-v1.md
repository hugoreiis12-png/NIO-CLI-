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
- **Passo 0 concluído (25 ago)**: só existe `auth_sessions` (JWT) como
  mecanismo de sessão agora — `token_session`/`setSessionToken` foram
  removidos do código, banco e `schema.sql` (migration
  `0003_drop_token_session.sql`, aplicada). Não é mais o primeiro item a
  conferir — já está feito.
- **Ainda 100% v1** (sem uso pelos caminhos ativos, mas presente no repo):
  `src/adapters/supabase/*`, `src/auth.ts`, `src/database.types.ts`,
  `src/core/ports.ts`, `src/lib/task-history.ts`, `@supabase/supabase-js` +
  script `gen:types` no `package.json`.
- **Achado de 25 ago — a ordem original estava errada**: `adapters/supabase/*`
  **não é removível antes** do redesenho do `nio init` — `context-step.ts` e
  `provision-step.ts` (que eu tinha classificado errado como "Manter,
  genérico") também importam tipos de lá, junto com `project-step.ts`/
  `auth-step.ts`/`index.ts`. `sync.ts` também importava (telemetria +
  "overview do NOS", ambos best-effort) — **esse já foi corrigido hoje**,
  removível independente. Ver "Ordem sugerida" atualizada.

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

## Passo 0 — ✅ Concluído (25 ago)

Unificação de sessão de login feita: `setSessionToken` removido da porta e
do adapter, `tokenSession` removido da entidade `UserCli`, migration
`0003_drop_token_session.sql` criada e **aplicada** no banco de teste,
`db/schema.sql` atualizado. `tsc`/`bun test` verdes. Só `auth_sessions`
(JWT) como mecanismo de sessão agora.

## Inventário classificado

### Remover (puro v1 — Supabase/NOS, sem uso no v2)

| Caminho | Papel | Observação |
|---|---|---|
| `src/adapters/supabase/*` (`client.ts`, `gateway.ts`, `context-gateway.ts`, `task-gateway.ts` (+`.test.ts`), `allocation-gateway.ts`, `analytics-gateway.ts`) | Adapter Supabase inteiro | ⚠️ **Bloqueado pelo redesenho do `nio init`** (ver "Migrar/Adaptar") — `context-step.ts`/`provision-step.ts`/`project-step.ts`/`auth-step.ts`/`index.ts` ainda importam daqui. Não é removível primeiro; é a ÚLTIMA coisa desta tabela a sair, não a primeira |
| ~~16 tools de tasks/sprints/alocação~~ | ✅ **Já removidas** (24 ago) | `src/tools/index.ts` só tem as 4 tools genéricas hoje |
| `src/lib/task-history.ts` | `HistoryEntry` do histórico de mudança de task (v1) | Só importado por `core/ports.ts` e `adapters/supabase/task-gateway.ts` — remove junto com o adapter |
| `src/core/ports.ts` — **só as interfaces `ContextGateway`/`TaskGateway`/`AllocationGateway`/`AnalyticsGateway`/`Gateway`** (linhas 40-177 na versão de 25 ago) | Porta `Gateway` do v1 | ⚠️ **NÃO apagar o arquivo inteiro** — o mesmo arquivo tem `InvestigationGateway` (linha 194+), propósito diferente (investigação read-only dual-IP), ainda usado por `adapters/postgres/read-only.ts`. Editar o arquivo removendo só as interfaces v1 + os imports que ficam órfãos (`ProjectConfig`, `ProjectContext`, `HistoryEntry`, `UsageEvent`, `Database`, os tipos de `./types.js`) — `InvestigationGateway` e os imports que ela usa (`DbTarget`, `QueryResult`) ficam |
| `src/database.types.ts` | Tipos gerados pelo Supabase CLI (`supabase gen types`) | Gerado, não escrito à mão — remover junto com o script que o gera |
| `src/auth.ts` (+ `src/auth.test.ts`) | Fluxo PAT→JWT do Supabase (`nio login <pat>` antigo) | **Já substituído** por `cli/commands/auth.ts` v2. Ainda importado por `project-context.ts` (mesmo cluster do `nio init`) — mesma dependência bloqueante do adapter |
| `package.json`: dependência `@supabase/supabase-js`, script `gen:types` | — | Remover só depois que todo o resto desta tabela já foi removido (senão `tsc` quebra primeiro) |
| `src/constants.ts`: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `TOKEN_EXCHANGE_URL`, `CREDENTIALS_DIR`, `CREDENTIALS_FILE`, `PAT_REGEX` | Constantes só usadas pelo `auth.ts` v1 | `brand.ts` também tem `supabaseUrl`/`supabaseAnonKey`/`patPrefix` — avaliar se sobra alguma razão pra mantê-los lá depois que `auth.ts` sumir |

### Migrar/Adaptar (hoje importam de Supabase, mas a *função* ainda faz sentido no v2)

| Caminho | O que tem de v1 | O que fazer |
|---|---|---|
| `src/lib/project-context.ts` | Importa `DbClient` de `adapters/supabase/client.js` e `ExchangeResult` de `auth.js`; todo o shape (`ProjectContextRepository`, `..Member`, etc.) é o domínio NOS (repos, membros, sprints) | Provavelmente morre junto com o domínio de projeto/task — mas confirme que `cli/commands/init/project-step.ts` (que o usa) não vira, antes, uma peça do wizard de perfil do v2. Ver linha abaixo |
| `src/cli/commands/init/project-step.ts`, `auth-step.ts`, `context-step.ts`, `provision-step.ts`, `index.ts` | O wizard `nio init` inteiro hoje faz "vincular `nio.json` a um projeto do NOS" — isso não existe no domínio v2 (que é sessão + perfil, não projeto+repo do NOS). **Correção de 25 ago**: `context-step.ts` (`DbClient` como tipo de parâmetro) e `provision-step.ts` (`AuthenticatedSession`) também importam Supabase — eu tinha classificado os dois errado como "Manter, genérico" na versão anterior deste documento. É o cluster inteiro do `init`, não só 3 arquivos | **Não é uma remoção mecânica.** É redesenho: o `nio init` do v2 deveria rodar o wizard de perfil (`Profile`) e criar uma `Session`, não pedir login Supabase nem projeto do NOS. Tratar como uma sub-tarefa de design própria, não só "apagar" — e é ela que desbloqueia a remoção do adapter Supabase inteiro (ver tabela "Remover") |
| `src/lib/telemetry.ts` | Importa só o **tipo** `DbClient` de `adapters/supabase/client.js` (pra tipar o client usado em `track()`) | Provavelmente basta trocar a assinatura pra receber o pool `pg` ou um client mais neutro — investigar se telemetria ainda faz sentido no v2 e, se sim, apontar pra onde vai gravar (Postgres `nio_cli`? outro lugar?) |
| ~~`src/session-factory.ts`~~ | ✅ **Já apagado** (24 ago) | Só tinha o `case 'supabase'`; MCP tools v2 falam direto com os repositórios, como o `cli/commands/auth.ts` já fazia |
| ~~`src/mcp-server.ts`~~ | ✅ **Resolvido** (25 ago) — `authenticateSession()` usa JWT/`auth_sessions` via `lib/session-store.ts`, Passo 0 concluído | — |
| ~~`src/cli/commands/sync.ts`~~ | ✅ **Resolvido** (25 ago) — importava `createAuthenticatedClient` pra telemetria + "overview do NOS" no harness, ambos best-effort (nunca bloqueavam). Removido; `track(null, ...)` já é no-op seguro | Confirmado com `nio sync --dry-run` rodando limpo até o fim |

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
- `src/cli/commands/init/clients-step.ts` — passo do wizard que escolhe cliente de IA, sem tocar em Supabase. **Correção (25 ago)**: `provision-step.ts` **saiu** desta lista — importa `AuthenticatedSession` de Supabase, faz parte do cluster do `init` (ver "Migrar/Adaptar").
- `src/core/session.ts`, `src/core/repositories.ts`, `src/adapters/pg/*`, `src/gateway/config.ts`, `src/gateway/services/`, `src/gateway/middleware/` — é o v2, óbvio, mas citado aqui pra registrar que **não é candidato a remoção**, é o destino.

## Ordem sugerida (reordenada 25 ago — a versão anterior tinha a dependência invertida)

0. ~~Passo 0 (unificar sessão)~~ — ✅ concluído.
0.1. ~~`sync.ts`~~ — ✅ concluído (25 ago) — era o único item independente
   fora do cluster do `init`; resolvido primeiro por ser rápido e seguro.
1. **Redesenhar `nio init`** (`project-step.ts`, `auth-step.ts`,
   `context-step.ts`, `provision-step.ts`, `index.ts`, + o que fazer de
   `project-context.ts`/`telemetry.ts`) — **isto é o bloqueio real**, não um
   passo qualquer no meio da lista. Enquanto o `init` depender de Supabase
   pra vincular projeto do NOS, nada no passo 2 é seguro de fazer. É sub-tarefa
   de design (o que o `init` do v2 faz — provavelmente o wizard de perfil +
   `Session`, ver `docs/v2/ARQUITETURA-CLIENTE-IA.md` sobre o handoff pro
   operador de IA), não mecânica — tratar como conversa própria com o dono
   do projeto antes de codar.
2. **Só depois** de 1 resolvido: apagar `src/adapters/supabase/*.ts` e
   `src/lib/task-history.ts`; **editar** (não apagar) `src/core/ports.ts`
   removendo só as interfaces v1 (`InvestigationGateway` fica — ver tabela
   "Remover" acima). Nesse ponto não deve sobrar nenhum import v1 apontando
   pra lá — confirme com o grep abaixo.
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
- Este documento foi atualizado em 25 ago 2026, numa auditoria de progresso
  (Passo 0 confirmado concluído; achei e corrigi 3 classificações erradas —
  `sync.ts`, `context-step.ts`, `provision-step.ts` não eram tão genéricos
  quanto a versão anterior dizia; `task-history.ts`/`core/ports.ts` faltavam
  na tabela "Remover"). É a terceira vez que este documento fica pra trás do
  código real — se você está lendo isto depois de 25 ago, refaça os greps
  desta seção antes de confiar nas tabelas cegamente, principalmente na
  ressalva do `core/ports.ts` acima (editar, não apagar).