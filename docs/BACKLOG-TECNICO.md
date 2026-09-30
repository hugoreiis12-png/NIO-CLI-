# Backlog técnico — NIO-CLI

> Gerado a partir da análise técnica completa do repositório em 2026-09-17/18 (arquitetura, banco de dados, segurança, qualidade de código). Cada item tem origem verificada em código/schema real — não é opinião genérica. Atualize este arquivo conforme os itens forem resolvidos (mova para "Resolvido" com data e commit).
>
> **Atualização 2026-09-19**: sprint cirúrgica fechou 8 dos 12 itens originais (ver [§ Resolvido](#resolvido)). Escopo excluído de propósito por ser arquitetural/infra, não cirúrgico: 2.1, 2.2, 3.1, 4.1 — seguem abertos abaixo, inalterados.
>
> **Atualização 2026-09-20 (manhã)**: análise de performance/latência (comparação contra a medição de 09-07, `[[cli-startup-perf]]`) — 4 itens novos em [§ 7](#7-performance--latência). Nenhum implementado ainda, todos só analisados por código/git history (sem acesso de rede ao provider de IA desta máquina).
>
> **Atualização 2026-09-20 (sprint organizacional)**: reorganização de módulos (separação `lib/auth`→`gateway/auth`/servidor vs cliente, split de `lib/docker.ts`, 2 renomes de clareza) + atualização de toda a documentação desatualizada (`README.md`, `AGENT.md`, `KONG-GATEWAY-USO.md`, `ARQUITETURA-ENVIRONMENT-BUILDER.md`, `ARQUITETURA-TUI-INTERACOES-MOTOR.md`, `PUBLISHING.md` + strings de `nio docs`/`--help`). Zero mudança de comportamento — `tsc`/`bun test`/`bun run build` verdes após cada passo. 1 bug real achado de bônus, registrado em **5.3**, não corrigido de propósito (fora do escopo "reorg pura"). `docs/TASKS-TUI-STREAMING.md` foi removido pelo dono do projeto — item 7.4 resumido inline.
>
> **Atualização 2026-09-21**: runbook de rotação de segredos/config de prod (JWT, senha do Postgres, gateway token, TLS) documentado em [§ 6.6](#66-runbook-de-rotação-de-segredosconfig-de-prod). Nenhum comando foi executado — é o procedimento pra quando H-1/H-2/6.1 forem tocados de fato. Confirmado por leitura de código: nenhum desses segredos entra no pacote npm (`package.json.files` não inclui `docker-compose.deploy.yml`, único lugar onde são referenciados).
>
> **Atualização 2026-09-29 (quarta passada completa)**: auditoria nova sobre a `v0.17.0` (commit `ebabc46`), com os gates rodados de verdade — não só leitura de código. Resultados: `tsc --noEmit` ✅ limpo · `bun test` ⚠️ **983 pass / 2 fail** · `bun audit` ❌ **6 vulns (3 high, 3 moderate)** · zero `any` ✅. Itens novos em [§ 8](#8-achados-de-2026-09-29--arquitetura-e-documentação) (arquitetura), [§ 9](#9-achados-de-2026-09-29--banco-de-dados) (banco), [§ 10](#10-achados-de-2026-09-29--qualidade-de-código) (qualidade) e [§ 11](#11-achados-de-2026-09-29--estabilidade-da-suíte) (suíte). Os achados **de segurança** desta passada (QP-1 a QP-6) estão em [`security/fourth-pass.md`](security/fourth-pass.md). **Nada foi implementado** — é análise, não sprint.
>
> Reverificações desta passada: **2.1** (7 imports diretos de `createSessionRepository`), **2.2** (agora 11 arquivos > 300 linhas), **3.1** (`log_session`/`session_activity` sem uma única referência em `src/`) e **5.3** (`mcpServerJsPath()` — **confirmado em runtime** no `dist/` construído, ver [§ 10.4](#104-mcpserverjspath-resolve-caminho-inexistente-médio--53-confirmado-em-runtime)) continuam **abertos e reproduzíveis**. O item **1.1** (`@docs/_patterns.md`) **regrediu** — ver [§ 8.3](#83-docs_patternsmd-voltou-ao-agentsmd--item-11-regrediu-baixo). A ressalva de 09-19 sobre 3 erros de `tsc` em `attachments.ts` **caducou** (era drift de `node_modules`, hoje limpo).

## Como usar

- **Severidade** segue a mesma escala da análise: CRÍTICO / ALTO / MÉDIO / BAIXO / INFO.
- **Evidência** aponta caminho:linha ou comando que confirma o achado — reverifique antes de agir, pode ter mudado desde a análise.
- Itens marcados **[decisão]** não têm resposta técnica única — exigem uma escolha do time antes de codar.

---

## 1. Harness / documentação

Todos os itens desta seção foram resolvidos em 2026-09-19 — ver [§ Resolvido](#resolvido) (1.1, 1.2, 1.3).

---

## 2. Arquitetura

### 2.1 Invariante do `SessionManager` furado em 7 pontos [MÉDIO]
`session-manager.ts:1-6` declara ser "o ponto ÚNICO" de acesso a sessão para CLI e MCP tools. Na prática, 7 arquivos importam `createSessionRepository` direto, pulando essa camada:
- `src/cli/commands/open.ts:5`
- `src/cli/commands/debug.ts:6`
- `src/cli/commands/docker.ts:35`
- `src/cli/commands/ai.ts:10`
- `src/cli/commands/deps.ts:6`
- `src/cli/flows/onboarding.ts:12`
- `src/tui/launch.tsx:13`

**Risco**: qualquer regra nova adicionada ao `SessionManager` (ex. validação de status antes de ler sessão) não se propaga a esses 7 pontos.
**Ação [decisão]**: migrar os 7 imports para passar pelo `SessionManager`, ou remover o invariante documentado se o acesso direto for intencional.
**Status (2026-09-19)**: reverificado, inalterado — fora de escopo da sprint cirúrgica (arquitetural, toca 7 arquivos).

### 2.2 Arquivos acima de 300 linhas (regra do harness) [MÉDIO — priorizar `state.ts`]

| Arquivo | Linhas (09-18) | Linhas (09-19) |
|---|---|---|
| `src/tui/state.ts` | 665 | **746** |
| `src/cli/commands/docker.ts` | 612 | 612 |
| `src/tui/components.tsx` | 551 | 595 |
| `src/lib/clients/client-configs.ts` | 522 | 552 |
| `src/tui/app.tsx` | 445 | 475 |
| `src/tui/app.test.tsx` | 393 | 393 |
| `src/gateway/index.ts` | 391 | 391 |
| `src/cli/commands/sync.ts` | 377 | 377 |
| `src/config.ts` | 343 | 343 |
| `src/tui/state.test.ts` | 339 | 424 |
| `src/lib/auth/nio-config.ts` | 331 | 331 |
| `src/cli/commands/docs/content.ts` | 308 | 308 |
| `src/adapters/pg/client.ts` | 304 | 304 |

**Ação**: quebrar por responsabilidade, começando por `state.ts` (mais que o dobro do limite).
**Status (2026-09-19)**: reverificado — **piorou**, não melhorou. `state.ts` (+81 linhas), `components.tsx` (+44), `client-configs.ts` (+30), `app.tsx` (+30), `state.test.ts` (+85) cresceram desde 09-18. Fora de escopo da sprint cirúrgica (alto risco de regressão na TUI).

### 2.3 Verticalização por camada técnica, não por domínio [INFO]
`src/` no nível 1 é organizado por camada técnica (`cli/`, `app/`, `adapters/`, `core/`, `gateway/`, `tools/`, `tui/`), o que diverge da letra da regra "verticalização por domínio/feature" do harness de back-end. Aceitável para um CLI de ferramenta única, mas registrar como divergência conhecida.
**Ação**: nenhuma urgente — reavaliar se o projeto crescer para múltiplos domínios de negócio.

---

## 3. Banco de dados

### 3.1 `log_session` e `session_activity` sem repository [MÉDIO]
Tabelas existem no schema com GRANTs dedicados e tipos de domínio em `src/core/types.ts:106-127`, mas nenhum adapter em `src/adapters/pg/` as lê ou escreve. Feature especificada, nunca conectada ao código.
**Ação [decisão]**: implementar os repositories, ou remover as tabelas/tipos se a feature foi abandonada.
**Status (2026-09-19)**: reverificado, inalterado — fora de escopo da sprint cirúrgica (feature nova, não bugfix).

### 3.2 Listagens sem paginação [BAIXO] — ✅ RESOLVIDO, ver [§ Resolvido](#resolvido)

### 3.3 Escrita multi-passo fora de transação em `issueSession` [BAIXO] — ✅ RESOLVIDO, ver [§ Resolvido](#resolvido)

### 3.4 `user_cli.ips_using` como TEXT em vez de JSONB [INFO]
Reservado para allowlist futuro (comentário da migration 0006). Aceitável hoje via YAGNI, mas sem índice se o uso crescer.
**Ação**: nenhuma agora — revisar se a feature de allowlist for implementada.

---

## 4. Segurança / infraestrutura

### 4.1 TLS ausente entre Kong e cliente no deploy LAN [ALTO — infra, não código]
`docker/docker-compose.deploy.yml` expõe `KONG_PROXY_LISTEN: "0.0.0.0:8000"` sem `ssl`. JWT, senha e OTP trafegam em claro na LAN do deploy.
**Ação [decisão]**: adicionar TLS no Kong (cert self-signed + distribuição de CA), ou documentar explicitamente "LAN confiável, TLS fora de escopo" como decisão aceita.
**Status (2026-09-19)**: reverificado, inalterado — fora de escopo da sprint cirúrgica (infra, não código).

### 4.2 Postgres TLS com verificação de certificado desligada no deploy [ALTO — já rastreado] — ✅ DOCUMENTADO, ver [§ Resolvido](#resolvido)
Nota: resolvido só no sentido de formalizar a decisão aceita em comentário — o TLS real em produção **continua pendente**, ver [§ 6](#6-tasks-pendentes-em-produção--não-reverberam-sozinhas).

---

## 5. Qualidade de código

5.1 e 5.2 resolvidos em 2026-09-19 — ver [§ Resolvido](#resolvido).

### 5.3 `mcpServerJsPath()` calcula profundidade errada [MÉDIO — bug real, achado durante o sprint organizacional de 2026-09-20]
`src/lib/clients/client-configs.ts` (função `mcpServerJsPath`) assume que o arquivo compila pra `dist/lib/mcp-server.js` (comentário: `.../dist/lib`), mas o arquivo está em `src/lib/clients/` — 2 níveis, não 1. `join(here, '..', 'mcp-server.js')` resolve pra `dist/lib/mcp-server.js`, que não existe; o real é `dist/mcp-server.js`. Usado em produção via `installCoworkGlobal()` (`cli/commands/sync.ts:249`), sem teste cobrindo.
**Ação**: `join(here, '..', '..', 'mcp-server.js')` (2 níveis, não 1) + teste cobrindo o path resolvido.
**Status**: pendente — não corrigido de propósito no sprint organizacional (era reorg pura, sem mudança de comportamento; isto é bug fix, não organização).

---

## 6. Tasks pendentes em produção — não reverberam sozinhas

> Contexto: mapeei as 3 esteiras reais (`ci.yml`, `image.yml`, `publish.yml`). Nenhuma toca o banco de prod (`ci.yml` usa Postgres efêmero, recriado do zero a cada run). O deploy do gateway (`image.yml`) e a publicação no npm (`publish.yml`) só disparam em **push de tag `v*`** — não em merge simples pra `main`. Itens abaixo são os que não chegam em prod só por estarem commitados.

### 6.1 Cortar release (`v*`) pra os 4 fixes de código chegarem em prod/npm [AÇÃO NECESSÁRIA]
`session-repository.ts` (LIMIT), `auth-session-repository.ts` (LIMIT), `login.ts` (comentário), `html.ts` (catch) estão prontos no working tree mas **não commitados ainda**. Reverberam sozinhos assim que: (1) commitar, (2) dar merge em `main`, (3) cortar uma tag `v*` — `image.yml` builda/empurra a imagem do gateway e faz bump automático do `docker-compose.deploy.yml` (Portainer redeploya); `publish.yml` publica no npm.
**Ação**: commitar as mudanças e cortar a tag de release quando decidido. Sem isso, nada do sprint chega em prod, independente do que estiver em `main`.

### 6.2 Verificar status real das migrations em prod [AÇÃO NECESSÁRIA — investigação, não código]
Durante a sprint, o banco de **teste local** apareceu com todas as 9 migrations "aplicadas" via `--baseline`, mas a constraint de `login_challenges.channel` ainda estava em `'sms'` — a migration `0009` nunca tinha rodado de fato, só foi marcada. Precisei aplicar a DDL da `0009` manualmente pra destravar os testes.
Esse fix foi **só no banco de teste local** — nenhuma automação propaga isso pra prod, e nenhuma migration nova foi criada nesta sprint (não há SQL pendente por causa dela). Mas não há visibilidade do estado real do schema de prod a partir daqui.
**Ação**: rodar `bun run db:migrate -- --status` apontando pra `NIO_DATABASE_URL` de prod **antes** de assumir que o schema está em dia. Se aparecer o mesmo tipo de drift, aplicar a migration faltante manualmente (mesmo procedimento usado no teste). Item já conectado ao **I-3** de `docs/security/README.md` ("rodar `db:migrate --baseline` em prod").

### 6.3 Confirmar se o comentário em `docker-compose.deploy.yml` disparou redeploy no Portainer [VERIFICAÇÃO — sem ação se negativo]
O comentário adicionado (formalizando a decisão de `NIO_DATABASE_SSL=false`) não muda nenhum valor funcional do compose. Não dá pra confirmar por código se o Portainer GitOps observa qualquer push em `main` que toque esse arquivo, ou só os commits automáticos do `image.yml` — comportamento configurado no Portainer, fora deste repositório.
**Ação**: se o Portainer redeployou o gateway por causa desse commit, foi um restart sem mudança funcional — nada a corrigir, só confirmar que não houve efeito colateral (ex. downtime inesperado).

### 6.4 TLS Postgres real em produção [AÇÃO NECESSÁRIA — já era pendência antes da sprint]
Ver 4.2 acima — o comentário só formaliza a decisão aceita hoje (`NIO_DATABASE_SSL=false` na LAN, cert self-signed). O tooling pra ligar TLS de verdade já existe (`scripts/db-tls-setup.sh`, CA interna) — falta só executar em prod. Não é uma pendência criada por esta sprint, mas segue sem dono.

### 6.5 `AGENTS.md` — não é uma pendência de prod
`AGENTS.md` está no `.gitignore` (`/AGENTS.md`) — nunca entra em `git push`, nunca chega no CI nem em prod por definição. É config local do harness do Claude Code (dev tooling), sem efeito no app rodando. Registrado aqui só pra não ser confundido com um item pendente — não precisa de ação em prod.

### 6.6 Runbook de rotação de segredos/config de prod
Procedimento pra quando H-1 (`docs/security/README.md`), H-2 e a rotação de credenciais do Postgres forem executados de fato. Roda inteiro **fora deste repo** (host de prod / stack do Portainer) — nenhum destes segredos é lido de arquivo versionado; todos entram como env var do stack (`docker/docker-compose.deploy.yml:75-82`). Confirmado por leitura de `package.json.files`: esse compose de deploy não é empacotado no npm, então nada abaixo tem qualquer efeito sobre o `npm publish`.

**1. `JWT_SECRET` — zero downtime (kid rotation, já suportado pelo código)**

```bash
# gera o novo segredo (≥32 chars, MIN_JWT_SECRET_LENGTH em src/gateway/config.ts:13)
openssl rand -base64 32
```

No stack do Portainer, adiciona `JWT_SECRETS` mantendo `JWT_SECRET` (o antigo) como está — ele segue validando tokens legados sem `kid`:

```
JWT_SECRETS=2026a:<valor-atual-de-JWT_SECRET>,2026b:<segredo-novo-gerado-acima>
```

Redeploy do `nio-gateway` (pega o env novo). Espera o TTL do token (`JWT_EXPIRES_IN`, default `12h` — `.env.example:28`) pra todo token antigo expirar. Depois:

```
JWT_SECRET=<segredo-novo>      # substitui o valor antigo de vez
JWT_SECRETS=                   # remove — só 1 segredo ativo, kid não é mais necessário
```

Redeploy de novo. Fluxo documentado em `.env.example:42-46`.

**2. Senha do Postgres (`nio_cli_user` / `nio_gw_user`)**

Rodar direto no Postgres de prod (os `CREATE USER` de login não estão versionados de propósito — só os `ROLE` sem login em `db/schema.sql:204-213`):

```sql
ALTER ROLE nio_cli_user  WITH PASSWORD '<senha-nova-1>';
ALTER ROLE nio_gw_user   WITH PASSWORD '<senha-nova-2>';
```

Depois, no stack do Portainer, atualiza as duas URLs **em paralelo** (senão a role antiga derruba a conexão antes do redeploy):

```
NIO_DATABASE_URL=postgres://nio_cli_user:<senha-nova-1>@<host>:5432/nio_cli
NIO_GATEWAY_DATABASE_URL=postgres://nio_gw_user:<senha-nova-2>@<host>:5432/nio_cli
```

Redeploy do `nio-gateway`. Sanity check pós-troca:

```bash
bun run db:migrate -- --status   # aponta pro NIO_DATABASE_URL de prod — confere schema em dia (item 6.2 acima)
```

**3. `NIO_GATEWAY_TOKEN` (token da app externa)**

```bash
openssl rand -base64 32
```
Atualiza no Portainer + no lado do consumidor externo do gateway (fora deste repo) **antes** do redeploy, senão a app externa perde acesso.

**4. TLS real do Postgres (H-2) — só se a decisão aceita em 6.4 mudar**

```bash
NIO_HOST=<ip-ou-hostname-do-postgres> bash scripts/db-tls-setup.sh init
bash scripts/db-tls-setup.sh server "$NIO_HOST"
```

Segue as instruções que o próprio script imprime (`postgresql.conf`, `pg_hba.conf`, reiniciar o Postgres). Por fim, no stack:
```
NIO_DATABASE_SSL=true
NIO_DATABASE_CA=/caminho/para/ca.crt
```

**Status**: procedimento documentado, nenhum passo executado ainda. Ação real fica condicionada a decisão do time sobre quando rotacionar (H-1/H-3 pedem rotação de credencial; TLS depende de reverter a decisão de 6.4).

---

## 7. Performance / latência

> Contexto: análise de 2026-09-20, comparando a medição de 2026-09-07 (`cli-startup-perf`, memória do projeto) contra o código atual (13 dias de mudanças, incluindo `b3e45f7` e `0c24599`). Sem acesso de rede ao provider de IA (`192.168.0.140:8001` inalcançável desta máquina) — nada aqui foi remedido ao vivo, só analisado por leitura de código/git history. **Nenhum item foi implementado** — são candidatos a backlog, não trabalho feito.

### 7.1 Map-reduce roda a fase de map em série [ALTO — isolado, sem dependência de rede]
`src/lib/exec/map-reduce.ts:85-87` — `for (const chunk of chunks) { ... await complete(...) }` em vez de `Promise.all`. Só ativa quando o texto excede `NIO_AI_MAPREDUCE_THRESHOLD` (default 32.000 tokens ≈ ~128k caracteres) — mensagem normal não é afetada (é um no-op barato, só a estimativa de tokens via `exceeds()`). É chamado em **toda** mensagem enviada pela TUI (`app.tsx:249`), então o caminho já está em produção — só o custo de N chamadas seriais de LLM só aparece quando o input é grande.
**Ação**: trocar o loop por `Promise.all`.
**Plano de segurança contra regressão**: `compactInput` já é testável por injeção de dependência (`CompactDeps.complete`) — escrever um teste novo **primeiro**, com um `complete` fake que registra ordem/tempo de chamada e confirma concorrência, antes de tocar no loop. `Promise.all` preserva a ordem do array independente de qual chunk termina primeiro, então `summaries.join('\n\n')` continua determinístico. Os 3 testes existentes em `map-reduce.test.ts` continuam passando sem alterar nenhuma asserção existente — só adicionar. Sem limitador de concorrência por enquanto (YAGNI) — só entra se aparecer evidência real de que satura o backend local.
**Status**: pendente, não implementado. Sem dependência de rede pra implementar/testar.

### 7.2 `update-notifier` síncrono bloqueia o cold start [BAIXO — muda UX visível, precisa decisão]
`src/cli.ts:10` — `notifyCliIfUpdate()` roda sempre, antes do parse de comando. Já medido em 09-07: ~75ms de um cold-start de ~110ms (maior alavanca isolada).
**Ação**: adiar/lazy a checagem — o banner de update passa a aparecer **depois** do comando, não antes.
**Plano de segurança contra regressão**: `hyperfine` antes/depois como critério de aceite numérico (não "parece mais rápido"); teste confirmando que o notifier ainda dispara eventualmente, não que sumiu. Único dos 4 itens que muda comportamento visível pro usuário (timing do banner) — só prosseguir com confirmação explícita, já que o ganho (75ms) só importa em uso scriptado/repetido, não no uso interativo normal de um dev.
**Status**: pendente — aguardando decisão sobre o trade-off de UX, não é só técnico.

### 7.3 Remedir schema de MCP por request [INFO — verificação, não código, bloqueado por rede]
`src/lib/clients/nio-oc-config.ts` (isolamento de MCP por perfil via `XDG_CONFIG_HOME`, commit `0c24599`) endereçou estruturalmente o gargalo medido em 09-07 (comentário no próprio arquivo: `opencode serve` herdando todos os MCPs globais do usuário → ~93 tools / ~50k tokens de schema em cada request). O número **depois** do fix nunca foi remedido — a claim de melhoria existe só como raciocínio de código, não como dado novo.
**Ação**: quando a rede voltar, medir o schema real por request com o isolamento ativo e registrar o número ao lado do antigo (09-07) neste item.
**Status**: bloqueado — sem acesso a `192.168.0.140:8001` desta máquina.

### 7.4 Verificar se `delta` chega populado no evento `message.part.updated` [BAIXO — bloqueado por rede]
`docs/TASKS-TUI-STREAMING.md` foi removido pelo dono do projeto (2026-09-19, itens considerados resolvidos em prod) — a task original ficava lá, resumo aqui: instrumentação temporária em `src/tui/state.ts` (`applyEvent`, log condicional em `typeof p.delta === 'string'`), rodar `NIO_DEBUG=1 nio ai` ao vivo, checar `~/.nio/tui.log`, registrar resultado (0 ou N), remover o log antes de commitar. Zero risco de regressão por desenho — nada fica no código a menos que se decida implementar o hybrid delta+snapshot depois, e mesmo esse preserva o fallback de snapshot (`raw.text` como fonte de verdade quando `delta` não vem).
**Ação**: rodar quando a rede voltar; decidir a Task 1b só com o resultado real, não com suposição.
**Status**: bloqueado — sem acesso a `192.168.0.140:8001` desta máquina.

---

## 8. Achados de 2026-09-29 — arquitetura e documentação

> Contexto: quarta passada completa sobre a `v0.17.0` (commit `ebabc46`). Gates medidos na hora: `tsc --noEmit` ✅ limpo · `bun test` ⚠️ 983 pass / **2 fail** / 8 skip · `bun audit` ❌ **6 vulns (3 high, 3 moderate)** · zero `any` em produção ✅.
>
> Os achados **de segurança** desta passada (QP-1 a QP-6) estão em [`security/fourth-pass.md`](security/fourth-pass.md), não aqui.
>
> **Nenhum item desta passada foi implementado.** São candidatos a backlog.

### 8.1 `src/lib/` é uma quarta camada não declarada — 23% do código [MÉDIO]
O `AGENT.md` descreve a arquitetura hexagonal como `core/` · `app/` · `adapters/` · `gateway/` e **não menciona `src/lib/`**. Medido: `lib/` tem **9.180 linhas em 85 arquivos** — é o maior diretório do projeto, à frente de `app/` (4.231) e `core/` (1.013).

O problema não é o tamanho, é a mistura de camadas num único balde:
- **Lógica de app**: `lib/deps/` (scan e install de dependências), `lib/provision/`, `lib/exec/` (map-reduce, plan-delegate, qwen-client)
- **Adapter puro**: `lib/auth/gateway-client.ts` (HTTP), `lib/skills/skills-cache.ts` (rede + zip + cache em disco)
- **Utilitário legítimo**: `lib/proc.ts`, `lib/colors.ts`, `lib/duration.ts`, `lib/tool-result.ts`

36 arquivos não-teste de `lib/` fazem IO (`node:fs`, `node:child_process`, `fetch`). Na prática existe um bypass do hexágono do tamanho de um quarto do repositório — o que não invalida a disciplina de `core/` (que está limpa, ver § 8.4), mas significa que a regra documentada descreve 3/4 do código.

**Ação [decisão]**: escolher uma das três, não deixar implícito.
1. Realocar por camada: `lib/deps|provision|exec` → `app/`, `lib/auth/gateway-client|skills-cache` → `adapters/`, e `lib/` fica só com utilitário sem domínio (~1.500 linhas).
2. Declarar `lib/` como camada legítima no `AGENT.md`, com regra explícita do que entra (utilitário transversal sem regra de negócio) e do que não entra.
3. Aceitar como está e remover a alegação de hexágono estrito do `AGENT.md`.

Recomendação: **(2)** primeiro (é barato e para o sangramento), **(1)** incremental depois. A **(3)** desperdiça a disciplina real que existe em `core/`.

### 8.2 Subsistema Fabric/PowerBI/RAG fora da documentação — ~4.800 linhas [MÉDIO]
Medido por diretório:

| Área | Linhas (sem teste) |
|---|---:|
| `src/app/{dax-*,rag-*,schema-*,lesson-*,learning,measure-lookup,scan-to-schema}.ts` | 2.336 |
| `src/adapters/fabric/` | 1.072 |
| `src/tools/{fabric-*,pbi-*}.ts` | 940 |
| `src/adapters/{embed,powerbi}/` | 231 |
| `src/core/{fabric,rag,learning}.ts` | 226 |
| **Total** | **~4.800** |

Nada disso aparece no `AGENT.md` (que descreve `app/` como "SessionManager · EnvironmentBuilder · DependencyWatcher · DockerManager · LanguageConfigurator · ai-client") nem em `docs/arch/` — são 11 documentos de arquitetura e **nenhum** sobre Fabric. Existe `docs/security/runbook-fabric-prod.md`, que cobre operação, não desenho.

**Risco**: quem entra no projeto lê um mapa que descreve outro repositório. É a maior superfície do código e a menos documentada.

**Ação**: `docs/arch/ARQUITETURA-FABRIC-RAG.md` — ports (`core/fabric.ts`, `core/rag.ts`, `core/learning.ts`), fluxo de ingestão de schema, o loop `agent_lesson`, e o papel do `dax-guard` como gate local. Mais um parágrafo no `AGENT.md` ligando pra lá.

### 8.3 `@docs/_patterns.md` voltou ao `AGENTS.md` — item 1.1 regrediu [BAIXO]
O item 1.1 foi fechado em 2026-09-19 removendo a linha `@docs/_patterns.md` do `AGENTS.md`, com a justificativa verificada de que o arquivo nunca existiu no histórico git.

Hoje:
```
$ cat AGENTS.md
# AGENTS.md
## Harness
@docs/_rules/nio.md
@docs/_patterns.md      ← voltou

$ ls docs/_patterns.md
ls: cannot access 'docs/_patterns.md': No such file or directory
```

A referência quebrada está de volta no `AGENTS.md` do projeto **e** no `~/AGENTS.md` global. Toda sessão de agente começa tentando resolver um import inexistente.

**Ação**: remover a linha de novo nos dois arquivos. Para não regredir uma terceira vez, considerar criar `docs/_patterns.md` como stub apontando pra `docs/_rules/nio.md` — o caminho volta por hábito muscular, e um stub é mais barato que vigiar.

### 8.4 Itens de arquitetura reverificados nesta passada
- **`core/` é genuinamente puro** — zero import de `pg`/`node:fs`/`node:child_process` nos 9 arquivos. Os únicos imports são `./types.js` e tipos locais. Confirmado por grep exaustivo.
- **`SessionManager`/`EnvironmentBuilder` usam DI real** com default de produção, o que é o que permite 993 testes rodarem sem banco nem subprocesso. Padrão bom, vale preservar.
- **Uma inversão de dependência**: `src/adapters/pg/dax-memory-repository.ts:21` importa `questionHash` de `../../app/rag-templates.js` — adapter dependendo de app. É o único ponto onde a seta aponta ao contrário. **Ação**: mover `questionHash` para `core/rag.ts` (é função pura de hash) ou para o próprio adapter. Uma linha.
- **§ 2.1 continua aberto e intacto**: os mesmos 7 arquivos importam `createSessionRepository` direto, pulando o `SessionManager` que se declara "o ponto ÚNICO" em `session-manager.ts:1-6`. Reconfirmado arquivo por arquivo, sem mudança desde 2026-09-18.

---

## 9. Achados de 2026-09-29 — banco de dados

### 9.1 `log_session` e `session_activity` são schema morto [MÉDIO — § 3.1 reconfirmado]
O item 3.1 continua aberto, e a medição desta passada é mais forte que a anterior: além de não terem repository, as duas tabelas têm **zero referência em todo o `src/`**. A única menção é declarativa, em `core/types.ts:105` e `:117`.

São 2 tabelas, 6 índices e 2 FKs que nunca receberam um `INSERT` desde que foram criadas. Custo real: cada leitura do `schema.sql` (humana ou de agente) gasta atenção com um domínio que não existe.

**Ação [decisão]**: implementar o repository (se a auditoria de atividade de sessão ainda for um requisito) ou dropar em migration. A escolha tem 3 meses — o custo de deixar aberto é maior que o de qualquer das duas respostas.

### 9.2 Itens de banco reverificados
- **100% das queries são parametrizadas.** Grep por interpolação `${}` dentro de `query(` nos 22 arquivos de `adapters/pg/`: **zero ocorrências**. Sem superfície de SQL injection.
- **pgvector está declarado corretamente** — `CREATE EXTENSION IF NOT EXISTS vector` existe no `db/schema.sql:185` **e** nas migrations `0010_dax_rag.sql:26` e `0011_agent_lesson.sql:10`. Os três índices de embedding (`dax_doc_chunk`, `dax_query_template`, `agent_lesson`) estão cobertos nos dois caminhos (schema HEAD e incremental). Registrado porque um rascunho desta passada chegou a marcar isso como achado: o grep original filtrava `CREATE TABLE|INDEX|TYPE` e por construção nunca acharia `CREATE EXTENSION`. **Ausência num grep filtrado não é evidência de ausência** — reverificado e descartado.
- FKs com `ON DELETE CASCADE` em todas as tabelas filhas, CHECK constraints espelhando os union types de `core/types.ts`, índices compostos `(campo, at DESC)` nas tabelas de auditoria, GIN em `sessions.config`, trigger de `updated_at`. Modelagem sólida — nada a fazer.
- § 3.4 (`ips_using` como TEXT) continua aberto e continua INFO: a tabela `login_ip_events` já faz o trabalho melhor, então é resíduo do v1 esperando uma limpeza, não um risco.

---

## 10. Achados de 2026-09-29 — qualidade de código

### 10.1 Não há linter nem formatter no projeto [MÉDIO]
Nenhum ESLint / Biome / Prettier no `devDependencies`, e nenhum step de lint no `ci.yml` (que roda: scan de segredos → typecheck → build → Postgres efêmero → `bun test`).

O gate de **correção** é forte. O de **estilo** não existe, e o resultado é visível: `src/gateway/middleware/auth.ts` tem indentação inconsistente (2, 4 e 6 espaços dentro da mesma função) e 4 erros de digitação no docblock — "framewrok", "hanlder", "Algoritimo", "algoitimo". A lógica do arquivo é boa (é onde mora a checagem de `sub` do SP-2); ele só nunca passou por revisão de forma.

**Ação**: adicionar Biome (uma dependência, um `biome.json`, um step no CI). Escolhido sobre ESLint+Prettier por ser uma ferramenta só e não precisar de config de plugin pra TS+JSX. Rodar `biome check --write` uma vez gera um diff grande de formatação — fazer isso em **commit isolado**, sem mudança de comportamento, pra não poluir o `git blame` de nada substantivo.

### 10.2 Não existe script `test` no `package.json` [BAIXO]
130 arquivos de teste, 993 testes, e o `package.json` não tem `"test"`. O `ci.yml` chama `bun test` direto. Quem clona o repo não descobre como rodar a suíte pelo manifesto — e o `scripts` já tem 12 entradas, então a ausência parece deliberada sem ser.

**Ação**:
```diff
  "scripts": {
+   "test": "bun test",
+   "typecheck": "tsc --noEmit",
    "build": "...",
```
Adicionar `typecheck` junto pelo mesmo motivo — o CI o executa como `bunx tsc --noEmit`, sem atalho no manifesto.

### 10.3 Violações do harness: 11 arquivos > 300 linhas, 3 funções muito longas [MÉDIO — § 2.2 remedido]
Remedição do item 2.2 em 2026-09-29:

| Linhas | Arquivo |
|---:|---|
| 900 | `src/tui/state.ts` |
| 707 | `src/lib/clients/client-configs.ts` |
| 644 | `src/tui/app.tsx` |
| 614 | `src/cli/commands/docker.ts` |
| 595 | `src/tui/components.tsx` |
| 394 | `src/gateway/index.ts` |
| 377 | `src/cli/commands/sync.ts` |
| 356 | `src/lib/auth/nio-config.ts` |
| 351 | `src/config.ts` |
| 308 | `src/cli/commands/docs/content.ts` |
| 304 | `src/adapters/pg/client.ts` |

Funções acima de 30 linhas (regra do harness), as três que destoam de verdade:

| Linhas | Local | Função |
|---:|---|---|
| **553** | `src/tui/app.tsx:92` | `App` |
| **309** | `src/cli/commands/sync.ts:69` | `registerSyncCommand` |
| **170** | `src/tui/state.ts:457` | `applyEvent` |

Ressalva metodológica: as funções `create*` de `adapters/pg/` (78–95 linhas) aparecem na medição mas **não são violação real** — são factories que retornam um objeto de métodos curtos, um nível de abstração só. Mesmo caso em `createFabricGateway` (101) e `createDaxMemoryRepository` (88). Não gastar esforço aí.

**Padrão**: a dívida está concentrada no `tui/` (5.838 linhas, segundo maior diretório e o código mais novo). É o único lugar do repo que destoa visivelmente do rigor do resto — cresceu rápido e sem o mesmo cuidado.

**Ação**, em ordem de retorno:
1. `App` (553 linhas) — extrair os hooks de estado (`useChat`, `usePermissions`, `useQuestions`) e deixar o componente só de composição. É a maior alavanca isolada do repo.
2. `applyEvent` (170) — é um reducer com um `switch` grande; quebrar por família de evento (`applyMessageEvent`, `applyToolEvent`, `applyPermissionEvent`) mantendo o `switch` de topo como dispatcher.
3. `registerSyncCommand` (309) — é registro de subcomandos do commander; extrair um handler por subcomando.

### 10.4 `mcpServerJsPath()` resolve caminho inexistente [MÉDIO — § 5.3 CONFIRMADO em runtime]
O item 5.3 continua aberto. Esta passada o **confirmou no `dist/` construído**, não só por leitura:

```ts
// src/lib/clients/client-configs.ts:110-113
function mcpServerJsPath(): string {
  const here = dirname(fileURLToPath(import.meta.url)); // comentário diz ".../dist/lib"
  return join(here, '..', 'mcp-server.js');             // → dist/lib/mcp-server.js
}
```

```
$ ls dist/lib/clients/client-configs.js   ✅ existe  ← o arquivo compila AQUI
$ ls dist/mcp-server.js                   ✅ existe  ← o alvo real
$ ls dist/lib/mcp-server.js               ❌ No such file or directory  ← o que o código aponta
```

O arquivo compila para `dist/lib/clients/`, não `dist/lib/`. Falta **um nível** de `..`. O comentário inline está errado junto com o código, o que explica por que passou por duas revisões sem ser notado.

**Impacto**: `installCoworkGlobal()` (chamado por `nio sync`, `sync.ts:249`) escreve no `claude_desktop_config.json` do usuário uma entrada MCP com `args: ["<path inexistente>"]`. O conector nio no Claude Desktop não sobe.

**Fix**:
```diff
  function mcpServerJsPath(): string {
-   const here = dirname(fileURLToPath(import.meta.url)); // .../dist/lib
-   return join(here, '..', 'mcp-server.js'); // .../dist/mcp-server.js
+   const here = dirname(fileURLToPath(import.meta.url)); // .../dist/lib/clients
+   return join(here, '..', '..', 'mcp-server.js'); // .../dist/mcp-server.js
  }
```

**Teste de regressão** (o que teria pego isto):
```ts
test('mcpServerJsPath aponta pro dist/mcp-server.js que o build gera', () => {
  expect(mcpServerJsPath().replace(/\\/g, '/')).toMatch(/\/dist\/mcp-server\.js$/);
});
```
Exportar a função (hoje é privada) ou testar via `installCoworkGlobal` num tmpdir. A asserção precisa ancorar no **fim** do path — um teste que só cheque "contém mcp-server.js" passaria com o bug.

### 10.5 Itens de qualidade reverificados
- **Zero `any` em produção** — grep por `: any` / `as any` / `<any>` fora de testes: 0 ocorrências. `strict: true` no `tsconfig`.
- **Zero `shell: true`** fora de `lib/proc.ts`, que documenta o porquê (CVE-2024-27980). Todo subprocesso usa argv array — sem superfície de command injection.
- Qualidade de comentário acima da média: vários registram *por quê* com data e origem ("as mensagens abaixo vieram de `agent_lesson` em produção — não da documentação"). É o tipo que envelhece bem; preservar no refactor do § 10.3.
- Erros tipados por domínio (`SessionNotFoundError`, `AmbiguousSessionError`) e contrato de ports de IO respeitado (gateways devolvem `{status, error}`, não lançam).

**Sobre a ressalva de 2026-09-19 nos "Itens sem ação"**: os 3 erros de `tsc` em `src/tui/attachments.ts` (`xlsx`/`jimp` sem tipos) **não existem mais** — `tsc --noEmit` roda limpo hoje. Era drift de `node_modules` como diagnosticado, resolvido por `bun install`.

---

## 11. Achados de 2026-09-29 — estabilidade da suíte

### 11.1 Suíte instável no Windows: 2 testes falham por contenção, não por lógica [MÉDIO]
```
$ bun test
src/adapters/fabric/query-metrics.test.ts:
(fail) grava e lê de volta                       [9837.90ms]  ← timeout após 5000ms
(fail) linha corrompida é pulada, o resto é lido [10582.50ms] ← timeout após 5000ms
 983 pass · 8 skip · 2 fail — Ran 993 tests across 130 files. [34.35s]
```

O mesmo arquivo isolado:
```
$ bun test src/adapters/fabric/query-metrics.test.ts
 12 pass · 0 fail — Ran 12 tests across 1 file. [108.00ms]
```

**~100× mais lento dentro da suíte completa.** Não é bug de lógica no `query-metrics.ts` — os dois testes que falham são exatamente os dois que fazem `appendFileSync` + `readdirSync` reais em `tmpdir()`. A causa é contenção: 130 arquivos concorrendo por `tmpdir` no NTFS (com Defender no caminho) mais pools `pg` abertos por outros arquivos segurando o event loop.

**Por que importa mais do que parece**: o CI roda em Linux e passa. O desenvolvedor local vê vermelho, o gate vê verde. Suíte que falha "normalmente" deixa de ser lida — e aí a falha seguinte, que for real, passa batido.

**Ação**, em ordem de preferência:
1. Timeout explícito nos dois testes de IO: `test('...', () => { ... }, 30_000)`. Uma linha cada, honesto sobre o custo de IO em NTFS.
2. Se reaparecer em outros arquivos, investigar pools `pg` não fechados nos testes de integração — `afterAll(() => pool.end())` faltando é o suspeito.
3. Só se 1 e 2 não resolverem: `bun test --isolate`. Custa tempo de suíte; é a última opção, não a primeira.

### 11.2 `bun test` carrega o `.env` real [BAIXO]
A primeira linha da saída da suíte é `[0.12ms] ".env"`, e durante a execução aparecem avisos de TLS do banco:
```
[pg] AVISO: NIO_DATABASE_SSL_INSECURE=1 — TLS sem verificação de certificado.
```

Alguns desses avisos vêm de `client.test.ts` exercitando o caminho de propósito (legítimo), mas o `.env` de desenvolvimento estar no ambiente de teste significa que o resultado da suíte depende da máquina. É o mesmo mecanismo do item § 5.2 já resolvido ("1 teste falhando por drift de ambiente") — resolvido naquele caso pontual, não na causa.

**Ação**: `.env.test` com valores fixos e neutros, carregado pelo `bunfig.toml` (`[test] preload`), isolando a suíte do `.env` de dev. Confirmar antes se `lib/load-env.ts` já tem precedência para isso — pode ser só uma variável de ambiente no CI.

### 11.3 Cobertura de teste reverificada
130 arquivos de teste para 225 arquivos de produção (**~58%**), e do tipo certo: testam contrato, usam injeção de dependência em vez de mock de módulo, e os de integração estão separados por convenção de nome (`*.integration.test.ts`) rodando contra Postgres real no CI. Nada a fazer — é um ponto forte do projeto.

---

## Resolvido

### 1.1 `docs/_patterns.md` ausente — referência quebrada no `AGENTS.md` [MÉDIO] — ✅ 2026-09-19
Confirmado por `git log --all -- docs/_patterns.md`: nunca existiu no histórico (não foi apagado, nunca foi criado). `docs/_rules/nio.md` já cobre DRY/YAGNI/componentização na seção "Boas práticas" — a doutrina citada já está coberta lá.
**Fix**: removida a linha `@docs/_patterns.md` de `AGENTS.md` (projeto e global `~/AGENTS.md`, conteúdo idêntico). Reversível — não recriei o doc, seria inventar conteúdo sem fonte verificada.
**Commit**: pendente (working tree, ainda não commitado).

### 1.2 `docs/arch/ARQUITETURA-GATEWAY.md` desatualizado [BAIXO] — ✅ 2026-09-19
Achado ampliado durante a reverificação: 4 divergências reais, não só o `Bun.serve`/8787 original.
**Fix**: 4 células corrigidas na tabela "Camada por camada" e na tabela "Stack":
- linha 101 — `src/gateway/server.ts`/`Bun.serve`:8787 → `src/gateway/index.ts` (`node:http`, implementado)
- linha 104/114 — Twilio Verify (nunca contratado) → WhatsApp Business API (`src/adapters/sms/whatsapp.ts`, implementado)
- linha 105 — `user_cli.token_session` (coluna dropada na migration `0003`) → JWT + `sessionId`/`jti` em `~/.nio/session.json` (`src/lib/auth/cli-session-store.ts`, renomeado no sprint organizacional de 2026-09-20 — era `session-store.ts`)
**Commit**: pendente (working tree, ainda não commitado).

### 1.3 `docs/security/README.md` referencia arquivos inexistentes [MÉDIO] — ✅ 2026-09-19
Confirmado: 15 arquivos citados (ADR 0011/0012, `implemented.md`, `backlog.md`, etc.) não existem no working tree nem no histórico — apagados no commit `3e8f9b3`.
**Fix [decisão tomada]**: não reconstruí os 15 documentos (fora de escopo cirúrgico — perderia a fonte real). Converti os links markdown mortos em texto simples + adicionei nota de proveniência no topo do arquivo (commit que apagou os fontes, e que a tabela de status foi parcialmente reverificada por auditoria externa em 2026-09-19 — JWT `kid`-rotation, checagem de `sub`, `MAX_SESSIONS_PER_USER`, `breach-check.ts`, `db_roles`, todos batendo com o que a tabela já alegava).
**Commit**: pendente (working tree, ainda não commitado).

### 3.2 Listagens sem paginação [BAIXO] — ✅ 2026-09-19
`listByUser` (`session-repository.ts`) e `listActiveByUser` (`auth-session-repository.ts`) não tinham `LIMIT`.
**Fix**: `LIMIT $2` (teto 200) nas duas queries — teto defensivo, não paginação real por cursor/offset (mudar a assinatura do repository tocaria todos os callers, fora do escopo cirúrgico). Comentário `ponytail:` em cada arquivo documentando o teto e quando subir de nível. Risco identificado e registrado no código: `pruneExcessSessions` depende de ver todas as sessões ativas pra podar o excedente de `MAX_SESSIONS_PER_USER` (sem teto superior configurável) — 200 fica bem acima de qualquer valor razoável desse env var.
**Verificação**: `bun test src/adapters/pg/session-repository.test.ts src/adapters/pg/session-repository.integration.test.ts src/adapters/pg/auth-session-repository.test.ts` → verde.
**Commit**: pendente (working tree, ainda não commitado).

### 3.3 Escrita multi-passo fora de transação em `issueSession` [BAIXO] — ✅ 2026-09-19
**Fix [decisão tomada]**: documentado, não envolvido em `withTransaction`. `pruneExcessSessions` já é best-effort por design e não deve dar rollback na sessão nova recém-criada se a poda falhar — envolver os 3 writes numa transação acoplaria semântica de higiene à criação da sessão, sem necessidade real. Comentário de 6 linhas em `src/gateway/services/login.ts` explicando a decisão.
**Commit**: pendente (working tree, ainda não commitado).

### 4.2 Postgres TLS sem verificação de certificado no deploy [ALTO — documentação da decisão] — ✅ 2026-09-19
**Fix**: comentário expandido em `docker/docker-compose.deploy.yml` formalizando `NIO_DATABASE_SSL=false` como decisão aceita (não pendência esquecida), referenciando que o tooling (`scripts/db-tls-setup.sh`) já existe e falta só execução em prod.
**Nota**: isso documenta a decisão, **não liga o TLS**. Ligar de verdade em prod segue pendente — ver [§ 6.4](#6-tasks-pendentes-em-produção--não-reverberam-sozinhas).
**Commit**: pendente (working tree, ainda não commitado).

### 5.1 2 `catch {}` vazios em JS embutido [BAIXO] — ✅ 2026-09-19
`src/cli/commands/docs/html.ts:85,90`.
**Fix**: `catch(e){console.warn('theme:',e)}` nas duas ocorrências.
**Commit**: pendente (working tree, ainda não commitado).

### 5.2 1 teste falhando por drift de ambiente [INFO] — ✅ 2026-09-19
**Fix**: rodei `bun run db:migrate -- --baseline` no Postgres de teste local. Achado durante a execução: o baseline marcou a `0009` como aplicada sem o schema bater de verdade (`login_challenges.channel` ainda checava só `'sms'`) — apliquei a DDL da `0009` manualmente pra corrigir. Esse fix é só do ambiente de teste local (ver [§ 6.2](#6-tasks-pendentes-em-produção--não-reverberam-sozinhas) pra prod).
**Verificação**: `bun run db:migrate -- --status` → 9/9 aplicadas; suíte completa relevante → 13/13 passando.
**Commit**: N/A (mudança de estado de banco, não de código).

---

## Itens sem ação necessária (verificados como corretos, registrados para não re-auditar)

- Tipagem: zero `any` em produção, zero supressões de lint/type. **Ressalva 2026-09-19**: `tsc --noEmit` hoje reporta 3 erros em `src/tui/attachments.ts` (`xlsx`/`jimp` sem tipos) — investigado: são dependências presentes em `package.json`/`bun.lock` mas ausentes em `node_modules` local (drift de instalação, `node_modules` desatualizado em ~12 dias vs. o lockfile). Não é regressão de código; `bun install` resolve. Não corrigido nesta sprint — fora de escopo.
- Hashing de senha (argon2id), pepper, JWT (HS256 travado, `jti`=session real, revogação funcional), OTP, backup codes, breach-check (HIBP k-anonymity) — todos verificados como sólidos.
- Nenhum segredo hardcoded, `.env` no `.gitignore`.
- `dist/` corretamente fora do controle de versão.
- Nenhuma API exclusiva do Bun em `src/` — compatibilidade Node >=20 real, não só declarada.
- Duplicação em `src/profiles/*` é dado tabular legítimo, não código repetido.
