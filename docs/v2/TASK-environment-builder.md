# Tarefa — `EnvironmentBuilder`: materializar o ambiente a partir do `Profile`

> Para o agente que pegar esta tarefa: leia
> `docs/v2/ARQUITETURA-ENVIRONMENT-BUILDER.md` inteiro antes de tocar em código —
> ele explica o "porquê", o shape do `ProfileDefinition`, o diagrama do pipeline
> e as decisões de escopo já travadas (1ª fatia = **MCPs + toolchains**;
> `opencode.json` **global**). Execução **cirúrgica e incremental**: cada Tarefa
> abaixo termina com `bunx tsc --noEmit` limpo e `bun test` verde antes da
> próxima. Não faça um PR único gigante. Registre cada fatia entregue em
> `docs/v2/PROGRESSO.md`, no mesmo formato das entradas existentes.

## Contexto

Esta é a peça grande que **fecha o redesenho do `nio init`**. Hoje o `Profile`
escolhido no wizard só vira a string `sessions.profile` + filtro de skills — o
ambiente não é materializado. O alvo e a persistência **já existem**; falta quem
produza o dado:

- ✅ `EnvironmentConfig` (shape do `sessions.config` JSONB) — `src/core/session.ts:30`
- ✅ `sessions.config JSONB` + índice GIN — `db/schema.sql:31,39`
- ✅ `SessionRepository.updateConfig(id, config)` e `NewSessionInput.config?` — `src/core/repositories.ts:42,68`
- ✅ Infra de instalação reaproveitável (`spawnSync` sem shell, allowlist, marcador de idempotência, glob de detecção) — `src/lib/dependency-install.ts`, `src/lib/dependencies.ts`
- ✅ Merge defensivo do `opencode.json` — `planOpencodeUpdate`/`installOpencodeGlobal` em `src/lib/client-configs.ts:257,290`
- ❌ `src/profiles/` (catálogo), ports `ProfileCatalog`/`ToolchainGateway`, `app/EnvironmentBuilder` — **nada disso existe ainda**
- ❌ Quem popula `sessions.config` — `resolveSessionSetup` cria a Session com `config: {}`

## Princípios orientadores

1. **Regra do hexágono (CLAUDE.md):** `src/profiles/` e os ports são core, **sem
   IO nenhum** (sem `pg`, sem `fs`, sem `child_process`). Quem instala/escreve são
   os adapters (`adapters/pkg/`, `lib/client-configs.ts`). O `EnvironmentBuilder`
   (app) orquestra, não faz IO direto.
2. **Não reinventar instalação.** O `ToolchainGateway` reusa o padrão
   `spawnSync(program, args, …)` **sem shell** de `runDependencyInstall`
   (`src/lib/dependency-install.ts:155`). Args sempre em array, nunca string
   concatenada — é regra de segurança do projeto. Para `detect`, reusar
   `globExists` (`dependency-install.ts:71`) — **hoje é privada** (`function`, não
   `export function`): exporte-a (preferível, é reuso real) em vez de duplicar a
   lógica de glob.
3. **Um lugar só mexe no `opencode.json`.** O `EnvironmentBuilder` **não** escreve
   o arquivo; ele devolve os `McpSpec[]` do perfil, e o passo de provisionamento
   de clientes (`installClients`/`client-configs.ts`) é quem grava — junto do
   `mcp.nio` que já grava hoje.
4. **Falha parcial não aborta a sessão.** A `Session` já foi criada antes do
   builder rodar. Toolchain que falha vira aviso e **não** entra no
   `EnvironmentConfig` resolvido; o ambiente é incremental (o watcher de
   dependências completa depois). Nunca deixe o `init` estourar stack trace cru.
5. **Comece por 1, não por 6.** Um perfil e um toolchain de ponta a ponta antes
   de preencher o catálogo inteiro.

## Tarefa 1 — Catálogo + `ProfileDefinition` (core puro, sem IO)

Criar `src/profiles/`:
- `src/profiles/types.ts` — `ProfileDefinition`, `McpSpec`, `ToolchainSpec` (shapes
  propostos na seção "`ProfileDefinition`" do doc de arquitetura).
- `src/profiles/<perfil>.ts` — **começar com UM só**: `dba` ou `analyst` (têm MCPs
  óbvios: Postgres read-only / PowerBI). Declarar `languages`, `toolchains`,
  `frameworks`, `mcps`, e opcionalmente `envVars`/`aliases`.
- `src/profiles/index.ts` — `ProfileCatalog.get(profile): ProfileDefinition`.
  O port `ProfileCatalog` vai junto dos **ports v2** (`src/core/repositories.ts`,
  onde estão `SessionRepository`/`UserRepository`) ou num arquivo novo e limpo
  (`src/core/environment.ts`). **Não** colocar em `src/core/ports.ts` — esse é o
  arquivo **legado v1** (tem `Gateway`/`TaskGateway`, em remoção parcial pela
  `TASK-remocao-v1.md`). Confirmar a escolha (estender `repositories.ts` vs.
  `core/environment.ts` novo) com o dono do projeto se não estiver óbvio.

Cuidado: os 6 valores de `Profile` (`src/core/session.ts:13`) são um union
fechado — o catálogo deve cobrir os 6 eventualmente (Tarefa 6), mas nesta tarefa
os perfis ainda sem definição podem lançar um erro claro ("perfil X ainda não
tem ambiente definido") em vez de retornar `undefined`.

Verificação: `bunx tsc --noEmit` + `bun test` (teste novo do catálogo: `get`
devolve o perfil implementado; perfil não-implementado lança erro claro).

## Tarefa 2 — MCPs do perfil no `opencode.json`

Estender `planOpencodeUpdate` (`src/lib/client-configs.ts:257`) para fundir
`McpSpec[]` do perfil junto do `mcp.nio` que já grava. Seguir o **mesmo spread
defensivo** que já existe (`...existing`, `...servers`) — nunca sobrescrever o
objeto inteiro nem apagar chaves do usuário.

- Formato OpenCode: cada MCP é `{ type: 'local', command: string[], environment?,
  enabled: true }` sob a chave `mcp` (ver o `nioEntry` atual como referência).
- O `alreadyConfigured` precisa passar a considerar os MCPs do perfil também
  (senão um init idempotente vai marcar "já configurado" sem gravá-los).

Verificação: `bunx tsc --noEmit` + `bun test`. Casos novos no teste de
`client-configs`: perfil com 1 MCP → chave aparece no JSON; roda de novo →
idempotente; `mcp.nio` continua intacto ao lado; chave do usuário não-nio
preservada.

## Tarefa 3 — `EnvironmentBuilder` (só MCPs ainda) plugado no `init` — 1ª fatia vertical

- `src/app/environment-builder.ts` — `build(profile, selection?)`:
  1. `catalog.get(profile)` → `ProfileDefinition`
  2. (toolchains: **ainda não** — Tarefa 4)
  3. devolve `{ config: EnvironmentConfig, mcps: McpSpec[] }` — `config` com
     `languages`/`frameworks`/`mcps` (ids) do perfil; `mcps` (specs) pra quem
     escreve o `opencode.json`.
- Plugar em `resolveSessionSetup` (`src/cli/commands/init/index.ts`): depois do
  `sessionRepo.create(...)`, chamar o builder e `sessionRepo.updateConfig(
  session.id, env.config)`. Passar os `env.mcps` adiante para o passo de
  `installAndProvisionClients` (que já grava o `opencode.json`).

**Ponto de parada visível:** rodar `nio init` com o perfil implementado e
confirmar (a) `sessions.config` populado no Postgres (`SELECT config FROM
sessions WHERE id = …`) e (b) o MCP do perfil no `~/.config/opencode/
opencode.json`. Sem instalar toolchain ainda.

Verificação: `bunx tsc --noEmit` + `bun test` + smoke manual do `nio init`
(como em `TASK-cliente-ia-fixo.md`: `@clack/prompts` exige TTY, use `expect`, não
pipe).

## Tarefa 4 — `ToolchainGateway` + `adapters/pkg/` (o passo de maior risco)

- Port `ToolchainGateway.ensure(spec: ToolchainSpec): Promise<EnsureResult>` em
  core.
- `src/adapters/pkg/*` — implementação: `detect?` reusa `globExists`
  (`dependency-install.ts`); `install` reusa o padrão `spawnSync(program, args,
  { stdio: 'inherit' })` **sem shell**; marcador de idempotência
  (`~/.nio/installed-deps.json` já existe — decidir se reusa ou cria um próprio
  pra toolchains).
- Ligar no `EnvironmentBuilder.build` (passo 2 que ficou pendente na Tarefa 3).
  Aplicar o princípio #4: toolchain que falha → aviso + fica fora do
  `EnvironmentConfig`, não aborta.
- Começar com **1 toolchain** do perfil implementado.

Verificação: `bunx tsc --noEmit` + `bun test` (a instalação real não dá pra
automatizar em `bun test` — testar a **resolução** detect→plano com o gateway
mockado/injetado; a instalação de verdade vai no smoke manual). Smoke: perfil com
toolchain ausente → instala; roda de novo → detecta e pula; toolchain com
`install` que falha → aviso, sessão segue.

## Tarefa 5 — envVars/aliases → dotfiles (fase 3, menor prioridade)

Materializar `envVars`/`aliases` do `ProfileDefinition` em dotfiles/shell.
Escopo e destino (qual arquivo de shell, como não sobrescrever config do usuário)
a definir com o dono do projeto antes de codar — **não bloqueante** para as
Tarefas 1-4.

## Tarefa 6 — Completar os 6 perfis no catálogo

Depois que o pipeline (Tarefas 1-4) estiver sólido com 1 perfil, preencher os
outros 5 (`fullstack`, `scientist`, `qa`, `bi`, e o que faltar de `dba`/`analyst`).
Cada perfil é só dados no catálogo — sem código novo de pipeline.

## Dependência com outras tasks (não confundir escopo)

- **`project-step.ts` órfão** e a remoção do cluster Supabase são da
  `TASK-remocao-v1.md` (o redesenho do `init` que destravou isso já está feito) —
  **não** é escopo desta task. Se precisar tocar em `resolveSessionSetup`, cuidado
  para não reintroduzir import de Supabase.
- **Checkbox de 1 opção** e **auth do `big-pickle` antes do handoff** são da
  `TASK-cliente-ia-fixo.md` — também fora daqui.

## Como verificar (a cada passo)

```bash
bunx tsc --noEmit
bun test

# Smoke do init (precisa de TTY — @clack/prompts; use expect, não pipe):
nio init   # roda o wizard com o perfil implementado
# confirma sessions.config populado:
psql "$NIO_DATABASE_URL" -c "SELECT id, profile, config FROM sessions ORDER BY created_at DESC LIMIT 1;"
# confirma MCPs do perfil no opencode.json:
cat ~/.config/opencode/opencode.json
```

## Riscos conhecidos

- **Instalação de software é o risco real** (Tarefa 4) — isole-a das Tarefas 1-3,
  que são puras/config. Nunca rode `spawnSync` com `shell: true` nem monte
  comando por concatenação de string (regra de segurança do projeto).
- **`opencode.json` é global** (decisão travada) — rodar `nio init` com outro
  perfil noutra pasta sobrescreve os MCPs do perfil anterior. É aceito por ora;
  não "conserte" migrando pra config de projeto sem falar com o dono do projeto
  (é sub-tarefa separada, ver "Questões em aberto" do doc de arquitetura).
- Este documento reflete o código em **25 ago 2026**. Antes de seguir cegamente,
  confira `src/lib/client-configs.ts` e `src/core/repositories.ts` de novo — a
  base v2 muda rápido.
