# Tarefa — Desligar e remover o v1 (NOS/Supabase) do NIO-CLI

> Para o agente que pegar esta tarefa: leia inteiro antes de tocar em código. O
> objetivo final é "nada de v1 é usado" (decisão do dono do projeto, 23 ago
> 2026), mas a execução é **cirúrgica e incremental** — cada passo termina com
> `bunx tsc --noEmit` limpo e `bun test` verde antes do próximo. Não faça um PR
> único gigante.

## Contexto

O v2 (orquestrador de ambientes) está sendo construído **ao lado** do v1
(cliente de tarefas/ponto do NOS, sobre Supabase), não substituindo-o de
uma vez. Estado nesta data:

- **Já migrado pra v2:** schema Postgres (`db/schema.sql`), pool de conexão
  (`src/adapters/pg/client.ts`), hashing de senha (`src/lib/password.ts`),
  `UserRepository` (`src/adapters/pg/user-repository.ts`), e os comandos de
  auth da CLI (`nio register` / `nio login` / `nio logout` / `nio whoami` em
  `src/cli/commands/auth.ts`, com sessão local em `src/lib/session-store.ts`
  → `~/.nio/session.json`).
- **Ainda 100% v1:** as 20 tools do MCP server, o domínio de tasks/sprints/
  alocação, e tudo que fala com Supabase.

Esta tarefa é sobre a segunda parte: desligar e remover o que ainda é v1,
sem quebrar o que já foi migrado.

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

## Inventário classificado

### Remover (puro v1 — Supabase/NOS, sem uso no v2)

| Caminho | Papel | Observação |
|---|---|---|
| `src/adapters/supabase/*` (`client.ts`, `gateway.ts`, `context-gateway.ts`, `task-gateway.ts` (+`.test.ts`), `allocation-gateway.ts`, `analytics-gateway.ts`) | Adapter Supabase inteiro | Nada no v2 importa daqui hoje, exceto os módulos listados em "Migrar/Adaptar" abaixo |
| `src/tools/get-context.ts`, `list-projects.ts`, `set-project.ts`, `list-tasks.ts`, `get-task.ts`, `create-task.ts`, `update-task.ts`, `move-task.ts`, `comment-task.ts`, `start-allocation.ts`, `end-allocation.ts`, `start-task-allocation.ts`, `end-task-allocation.ts`, `get-active-allocation.ts`, `list-my-allocations.ts`, `record-delivery.ts` (+ todos os `.test.ts` correspondentes) | 16 das 20 tools MCP — domínio de tasks/sprints/ponto | Ver "Migrar/Adaptar" pros outros 4 (`plan`, `validate-plan`, `delegate-exec`, `exec-status` — **esses ficam**, são genéricos, ver abaixo) |
| `src/lib/task-history.ts` | `HistoryEntry` do histórico de mudança de task | Só usado pelas tools de task acima |
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
| `src/session-factory.ts` | `Backend = 'supabase'` é o único `case` | Depois que o domínio de sessão v2 tiver seu próprio gateway (`SessionGateway`/`SessionRepository` completo), trocar o `switch` pra decidir entre os backends reais que sobrarem — ou remover o `session-factory` por completo se o v2 não precisar mais desse indireção (a MCP tools de v2 podem falar direto com `UserRepository`/`SessionRepository`, como `cli/commands/auth.ts` já faz) |
| `src/mcp-server.ts` | Chama `createSession()` (→ Supabase) pra autenticar o worker MCP, e registra as 20 tools v1 | Depois que as tools v1 saírem (ver tabela acima) e o `session-factory` for resolvido, trocar `authenticateSession()` pra ler a sessão v2 (`lib/session-store.ts`, o mesmo arquivo que `nio whoami` já lê) |

### Resolvido — não é v1, mas está superseded (decisão de 23 ago 2026)

| Caminho | Situação |
|---|---|
| `src/gateway/*` (`server.ts`, `sessions.ts`, `pkce.ts`, `authorize-*.ts`, `traceability.ts`, `types.ts`) | OAuth 2.0 + PKCE **sem Supabase** — não é v1. Mas o login real do v2 vai por senha+SMS (`docs/specs/auth/0003-login-2fa-sms.md`), não por este fluxo — a spec `0002-cli-native-login.md` que o originou foi marcada `status: superseded`. **Não remover ainda**: `authorize-store.ts` (Map com TTL, uso único) e `traceability.ts` são candidatos a reuso direto no Gateway core da 0003. Decidir remoção vs. reaproveitamento só quando a 0003 sair do rascunho |
| `workers/edge-filter/` | Mesma situação — Cloudflare Worker companion do Gateway acima. A 0003 também tem um "Edge Filter" no desenho (params ainda a definir); pode ser a mesma peça evoluída, ou pode nascer do zero. Não mexer até a 0003 amadurecer |

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
- `src/core/session.ts`, `src/core/repositories.ts`, `src/adapters/pg/*` — é o v2, óbvio, mas citado aqui pra registrar que **não é candidato a remoção**, é o destino.

## Ordem sugerida

1. Remover as 16 tools v1 + seus testes de `src/tools/index.ts` (tirar os
   imports e as entradas do `tools`/`toolDefinitions`) — o servidor MCP passa
   a expor só `nio_plan`, `nio_exec_status`, `nio_delegate_exec`,
   `nio_validate_plan` (mais o que existir de v2 quando `SessionRepository`
   nascer).
2. Apagar os arquivos das 16 tools + `lib/task-history.ts`.
3. Apagar `src/adapters/supabase/*.ts` — nesse ponto só devem sobrar erros de
   `tsc` em `project-context.ts`, `telemetry.ts`, `session-factory.ts`,
   `mcp-server.ts`, `cli/commands/init/*` (a tabela "Migrar/Adaptar").
4. Resolver `telemetry.ts` (trocar o tipo do client) e decidir o destino de
   `project-context.ts` + o wizard `init` (provavelmente uma sub-tarefa
   separada de design, não mecânica).
5. Resolver `session-factory.ts` e `mcp-server.ts` por último — são o ponto
   de entrada, então só fazem sentido depois que o resto já não depende de
   Supabase.
6. Apagar `src/auth.ts` (+ teste) e as constantes órfãs em `constants.ts`.
7. Tirar `@supabase/supabase-js` do `package.json` e o script `gen:types`;
   apagar `src/database.types.ts`.
8. Rodar `bun run gen:docs` pra regenerar a tabela de tools do `README.md`.
9. Atualizar `docs/v2/PROGRESSO.md` com o resumo da limpeza.

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
- Este documento reflete o estado do repo em 23 ago 2026 (commit `f1ebea5` +
  os commits desta sessão que adicionaram `cli/commands/auth.ts` v2 e
  `lib/session-store.ts`). Se o código já andou desde então, confira os
  imports de novo antes de seguir a tabela cegamente.