# Backlog técnico — NIO-CLI

> Gerado a partir da análise técnica completa do repositório em 2026-09-17/18 (arquitetura, banco de dados, segurança, qualidade de código). Cada item tem origem verificada em código/schema real — não é opinião genérica. Atualize este arquivo conforme os itens forem resolvidos (mova para "Resolvido" com data e commit).
>
> **Atualização 2026-09-19**: sprint cirúrgica fechou 8 dos 12 itens originais (ver [§ Resolvido](#resolvido)). Escopo excluído de propósito por ser arquitetural/infra, não cirúrgico: 2.1, 2.2, 3.1, 4.1 — seguem abertos abaixo, inalterados.
>
> **Atualização 2026-09-20 (manhã)**: análise de performance/latência (comparação contra a medição de 09-07, `[[cli-startup-perf]]`) — 4 itens novos em [§ 7](#7-performance--latência). Nenhum implementado ainda, todos só analisados por código/git history (sem acesso de rede ao provider de IA desta máquina).
>
> **Atualização 2026-09-20 (sprint organizacional)**: reorganização de módulos (separação `lib/auth`→`gateway/auth`/servidor vs cliente, split de `lib/docker.ts`, 2 renomes de clareza) + atualização de toda a documentação desatualizada (`README.md`, `AGENT.md`, `KONG-GATEWAY-USO.md`, `ARQUITETURA-ENVIRONMENT-BUILDER.md`, `ARQUITETURA-TUI-INTERACOES-MOTOR.md`, `PUBLISHING.md` + strings de `nio docs`/`--help`). Zero mudança de comportamento — `tsc`/`bun test`/`bun run build` verdes após cada passo. 1 bug real achado de bônus, registrado em **5.3**, não corrigido de propósito (fora do escopo "reorg pura"). `docs/TASKS-TUI-STREAMING.md` foi removido pelo dono do projeto — item 7.4 resumido inline.

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
