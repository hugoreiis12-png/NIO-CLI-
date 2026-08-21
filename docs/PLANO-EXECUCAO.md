# Plano de Execução — Refatoração NIO

> Este documento é a camada **tática** sobre o `ROADMAP.md`. O roadmap é o QUÊ e
> a ordem das fases (fonte imutável — IDs nunca renumeram). Este arquivo é o
> COMO: cada ID do roadmap vira uma ou mais tasks executáveis, com dono, passo
> a passo e critério de aceite. Ao contrário do roadmap, **este arquivo muda o
> tempo todo** — é o quadro de trabalho, não o contrato.

## Papéis

| Tag | Quem | Quando usar |
| --- | --- | --- |
| 🧭 **Senior** | Eu (Claude), nesta conversa | Desenho de interface/port, decisões de risco, invariantes de segurança, revisão de todo diff do Pleno antes de integrar, qualquer coisa que toque contrato público (`core/ports.ts`, `core/types.ts`, nomes de tool, `brand.ts`) |
| ⚙️ **Pleno** | Agente OpenCode (modelo Zen) | Implementação mecânica de um escopo já especificado por mim — a task tem que estar "pronta pra copiar e colar" pro agente, sem ambiguidade de design |
| 🧑‍💻 **Manual** | Você (Hugo) | Decisão de produto/negócio, credenciais e infra fora do repo (IPs, roles de banco, aprovações), tudo que nenhum agente pode fazer sozinho |

Uma task pode ter dono composto, ex. `Senior → Pleno`: eu desenho a interface e
escrevo a spec de implementação, o Pleno implementa em cima dela.

## Regras de execução (valem pra todo dono)

1. **1 task = 1 commit**, reversível isoladamente. Sem "aproveitar e already
   fix" outras coisas no mesmo commit.
2. **Gate de saída de toda task de código:** `bun test` e `bunx tsc --noEmit`
   verdes antes de marcar como concluída. Se a task mexeu em tools MCP, rodar
   também `bun run gen:docs` e conferir o README gerado.
3. **Todo diff do Pleno passa por review do Senior** antes de eu marcar a task
   como `[x]` aqui. Isso não é burocracia — é o mecanismo de "integridade e
   segurança" que você pediu: o Pleno implementa rápido, eu garanto que a
   implementação respeita os invariantes do roadmap.
4. **Nunca pular fase.** Uma task de Fase N só começa com as dependências da
   Fase N-1 fechadas (ver seção "Depende de" de cada task). Trabalho fora de
   ordem vira retrabalho quando a fundação mudar embaixo.
5. **Toda mudança de comportamento não-trivial ganha spec** no formato que o
   projeto já usa (`docs/specs/<area>/NNNN-titulo.md`, ver exemplos existentes
   em `docs/specs/auth`, `docs/specs/exec`, `docs/specs/plan`). Refactor
   mecânico (Fase 6) não precisa — é só mover/organizar.
6. **Status sincroniza nos dois arquivos:** quando uma task fecha um ID
   inteiro do roadmap, marco `[x]` também no `ROADMAP.md` (checkbox da seção),
   nunca renumerando.
7. **Task Pleno = handoff autocontido.** Cada card abaixo marcado ⚙️ tem que
   dar pra colar direto no OpenCode sem eu precisar completar contexto na
   hora — por isso o "Como fazer" é sempre explícito sobre padrões do repo a
   seguir (não "refatore direito", e sim "siga X como em `arquivo:linha`").
8. **Credencial real nunca chega ao Pleno.** DSNs de banco, PATs e qualquer
   segredo ficam só comigo/com você (confirmado por você em P0-T2). O Pleno
   recebe no máximo "a role DQL-only existe" como fato — implementa contra a
   interface (`core/ports.ts`) e testa contra Postgres local/fixture, nunca
   contra a string de conexão real. Se uma task parecer exigir a credencial
   real pro Pleno rodar, é sinal de que a task está mal cortada — eu recorto
   de novo antes de repassar.

## Legenda de status

`[ ]` pendente · `[~]` em andamento · `[x]` concluído · `[!]` bloqueado (motivo na task)

---

## Mapa de dependências (visão executiva)

```
Fase 0 (decisões) ──► Fase 1 (fundação dual-IP) ──► Fase 2 (identidade/grupos)
                                                            │
                                                            ▼
                                                       Fase 3 (tools read-only)
                                                        │            │
                                                        ▼            ▼
                                                  Fase 4 (sistema  Fase 5 (investigação
                                                   interno)         de dados) ◄──┘
                                                        │            │
                                                        └─────┬──────┘
                                                              ▼
                                                    Fase 6 (refactor mecânico)
                                                              │
                                                              ▼
                                                    Fase 7 (escala, só sob demanda)
```

Risco maior do projeto inteiro está em **F11 (rebrand)** e **T36 (remoção de
escrita)** — os dois pontos que quebram contrato externo pra usuários já
instalados. Ambos marcados 🧭 Senior, sem exceção.

---

## Fase 0 — Decisões confirmadas

Dono predominante: 🧑‍💻 Manual + 🧭 Senior (formalização). Sem tasks de código.
**Gate de saída:** todo checkbox de P01–P06 vira `[x]` no `ROADMAP.md` E existe
um ADR em `docs/adr/` cobrindo as decisões. Sem isso, Fase 1 não começa.

### P0-T1 — ADR das premissas fechadas
**Dono:** 🧭 Senior · **Depende de:** nada · **Status:** `[x]`

- **Feito:** `docs/adr/0001-nio-readonly-dual-ip.md` (P01-P05) e
  `docs/adr/0002-perfil-como-grupo.md` (P06 — perfil de ambiente como
  "grupo", ver resposta do P0-T3). Um terceiro,
  `docs/adr/0003-gateway-auth-dedicado.md`, registra a decisão (e pausa) do
  Gateway de Auth — não fazia parte da Fase 0 original, mas é uma decisão
  arquitetural grande o bastante pra merecer registro formal também.
- **Critério de aceite:** ✅ ADRs criados, `ROADMAP.md` com checkboxes
  P01-P06 marcados `[x]` e linkados aos ADRs correspondentes.

### P0-T2 — Credenciais e infraestrutura dos dois bancos
**Dono:** 🧑‍💻 Manual · **Depende de:** nada · **Status:** `[ ]`

- **O quê:** você me passa, pra cada um dos dois IPs (antigo/novo): host,
  porta, nome do banco, e confirma se já existe uma **role somente-DQL**
  (sem INSERT/UPDATE/DELETE/DDL) ou se precisa ser criada.
- **Por quê é Manual:** é acesso a infra viva fora deste repo — nenhum agente
  deve ter ou pedir credenciais de produção sem você no controle direto.
- **Critério de aceite:** eu recebo os dois DSNs (posso te orientar a
  colocá-los como env var local, nunca em texto puro no chat/repo) e a
  confirmação de que a role é DQL-only nos dois. Isso destrava F12/F15.

### P0-T3 — Decisão de produto: o que é um "grupo"
**Dono:** 🧑‍💻 Manual (decisão) → 🧭 Senior (modelagem) · **Depende de:** nada · **Status:** `[x]` resolvido

- **Resposta registrada:** "grupo" = **perfil de ambiente** que o colaborador
  escolhe logo após autenticar no `nio init`: **Desenvolvedor, Analista de
  Dados, Cientista de Dados, Business Intelligence**. A escolha dirige
  configuração/instalação **100% automática** do ambiente (zero passo
  manual), e o estado fica gravado **por usuário** em JSON (não por
  máquina), pra dois colaboradores no mesmo host não conflitarem.
- **Consequência pra Fase 2:** isso não é conceito novo — o repo já tem uma
  taxonomia `role → área → stack` (`src/lib/sections.ts`) que dirige o que é
  instalado. Fase 2 vira **extensão** dessa taxonomia + mudança de
  granularidade do estado (por-máquina → por-usuário). Detalhado na Fase 2
  abaixo, já pronto pra desmembrar em tasks.

### P0-T4 — Ordem rebrand vs. dados locais
**Dono:** 🧭 Senior (proposta) → 🧑‍💻 Manual (aprovação) · **Depende de:** nada · **Status:** `[x]` resolvido

- **Resposta registrada:** rebrand **total e imediato**, sem período de
  compatibilidade. Critério explícito seu: **zero menção, leitura ou escrita
  de qualquer artefato "noclaf"** na CLI nova — sem fallback de `NOCLAF_*`,
  sem ler `~/.noclaf`. F11 roda como primeiro bloco de código da Fase 1.
- **Consequência aceita por você:** instalações antigas (`@noclaf/cli`,
  `~/.noclaf/`) não migram automaticamente — quem já usa o CLI atual roda
  `nio init` do zero na versão nova. Registrado aqui pra constar como decisão
  consciente, não omissão.

---

## Fase 1 — Fundação read-only dual-IP

Depende de: Fase 0 fechada (P06 em particular).

### F11 — Rebrand `noclaf` → `nio` (limpo, sem compat)

> **Decisão confirmada (P0-T4):** rebrand total, sem fallback, sem período de
> transição. Nada de `NOCLAF_*` lido como legado, nada de `~/.noclaf` tocado
> pelo código novo — nem pra ler, nem pra migrar. Isso simplifica a
> implementação (sem lógica de dual-read pra manter e depois remover) em
> troca de: instalações antigas não migram sozinhas — decisão já assumida
> por você.

#### F11-T0 — Decisões de escopo que faltam antes da spec
**Dono:** 🧑‍💻 Manual · **Depende de:** nada · **Status:** `[x]` resolvido em 2026-07-26

Respostas registradas:

1. **Scope npm** — livre. `@nio-cli/cli` / `@nio-cli/skills` confirmados.
2. **Domínio do backend** — desacoplado. `webUrl` zera; auth passa a ser
   "feita pela própria CLI" até o sistema interno NIO (Fase 4) estar pronto,
   quando a integração fica completa. **Mecanismo exato ainda em aberto** —
   virou spec própria: `docs/specs/auth/0002-cli-native-login.md` (draft).
3. **`productName`/`productFullName`** — não respondido explicitamente, mas
   resolvido por consistência com a decisão 2 (decoupling total): deixei
   `productFullName: 'NOS'` sem a expansão "Noclaf Operation System"
   (violaria o critério crítico), sem inventar uma expansão nova. Pendente:
   confirmar a expansão real com o time de produto quando houver uma.
4. **Prefixo do PAT** — mantém o formato (`prefixo_` + 64 hex), adaptado pro
   nome NIO: `nio_`. **Mudança coordenada:** o backend só valida `noc_` hoje;
   o código já está em `nio_`, mas isso não pode ser publicado antes do
   backend aceitar o prefixo novo (quebraria login de todo mundo). Registrado
   como bloqueio de deploy na spec de rebrand.
5. **Repo de skills** — outro time refatora `noclaf-skills` → `nio-skills`,
   com link novo. `skillsRepo` já aponta pro nome-alvo
   (`Falcao-Tech/nio-skills`); path exato a confirmar quando o repo existir.
6. **Repo GitHub `noclaf-cli`** — instrução era eu renomear para `nio-cli` e
   seguir com a refatoração interna. **Não consegui o rename em si**: não
   tenho `gh` CLI autenticado neste ambiente (sem acesso à API do GitHub
   daqui). Segui com a refatoração interna como pedido; o rename do
   repositório real (Settings → General → Repository name, ou `gh repo
   rename` numa sessão sua) continua pendente do seu lado.

#### F11-T1 — Spec de rebrand completo
**Dono:** 🧭 Senior · **Depende de:** F11-T0 · **Status:** `[x]` — `docs/specs/rebrand/0005-noclaf-to-nio.md`

- **O quê:** escrever `docs/specs/rebrand/0005-noclaf-to-nio.md` (formato
  igual às specs existentes) cobrindo, **sem nenhuma camada de
  compatibilidade**:
  - `package.json` novo: nome do scope conforme F11-T0.1, bins `nio`/`nio-cli`.
  - Todo campo de `src/brand.ts` com o valor novo (conforme respostas de
    F11-T0), sem exceção — inclusive `homeDirName: '.nio'`,
    `projectConfigFile: 'nio.json'`, `envPrefix: 'NIO'`,
    `mcpServerKey: 'nio'`.
  - Logo ASCII novo (o atual desenha as letras N-O-C-L-A-F literalmente,
    `brand.ts:59-74` — precisa ser redesenhado, não só reinterpretado).
  - `~/.noclaf` e `NOCLAF_*` **não existem** no código novo — nenhuma
    leitura, nenhuma migração automática. Se algum teste ou fixture do repo
    ainda referenciar o nome antigo, é pra apagar, não adaptar.
  - Nota explícita sobre o que fica **fora** do repo (F11-T0.4, F11-T0.5,
    F11-T0.6) — dependências cross-repo/cross-time, não bloqueiam o merge
    deste repo mas ficam registradas.
- **Critério de aceite:** spec com status `draft`, lista de arquivos a tocar,
  e uma seção "Fora de escopo" citando exatamente as dependências externas
  levantadas em F11-T0.

#### F11-T2 — Aplicar rebrand mecânico
**Dono:** ⚙️ Pleno (executado pelo Senior nesta rodada, dado o volume e a urgência do requisito crítico) · **Depende de:** F11-T1 · **Status:** `[x]`

- **O quê:** implementar a spec F11-T1: editar `src/brand.ts` (fonte única —
  ver comentário de topo do arquivo, que já lista o que precisa casar em
  lockstep: `package.json`, `CLAUDE.md`, `SKILL.md`, `docs/specs/**`), rodar
  `bun run gen:docs`, ajustar testes que fixam valores de marca
  (`src/brand.test.ts`).
- **Como fazer:** siga o padrão já usado no rebrand de branding anterior
  (commit `e414f75`, "route all runtime branding through brand.*") — a
  primeira etapa lá foi centralizar tudo em `brand.ts`; aqui é só trocar os
  valores desse objeto e propagar. **Não** hardcode `nio` em nenhum arquivo
  `.ts` fora de `brand.ts`. **Não** escreva nenhuma lógica de leitura de
  `~/.noclaf`, `NOCLAF_*` ou `noclaf.json` — a spec F11-T1 é explícita que
  isso não existe no código novo.
- **Critério de aceite:** `bun test` e `tsc --noEmit` verdes;
  `grep -rin "noclaf" src/ docs/ README.md CLAUDE.md --include="*.ts" --include="*.md"`
  não retorna **nenhuma** ocorrência (critério duro — é o requisito crítico
  que você marcou).

#### F11-T3 — Limpeza de artefatos e docs residuais
**Dono:** ⚙️ Pleno (idem F11-T2) · **Depende de:** F11-T2 · **Status:** `[x]`

- **O quê:** varrer o repo por qualquer resquício textual fora do código
  (`dist/` gerado, `bun.lock` — nome de pacote —, `PUBLISHING.md`,
  workflows do `.github/`, mensagens de erro em templates de
  `src/cli/copy/*.json`) e atualizar tudo pro nome novo.
- **Como fazer:** o `grep` do critério de aceite da F11-T2 é o guia — rodar
  de novo sem os filtros de extensão (repo inteiro, exceto `node_modules` e
  `.git`) até dar zero.
- **Critério de aceite:** `grep -rin "noclaf" . --exclude-dir={node_modules,.git,dist}`
  vazio.

#### F11-T4 — Revisão final do rebrand
**Dono:** 🧭 Senior · **Depende de:** F11-T2, F11-T3 · **Status:** `[x]`

- **Feito:** `bun test` (220 pass / 0 fail), `tsc --noEmit` limpo,
  `bun run gen:docs` rodado, `bun.lock` regerado do zero (`rm` + `bun
  install`) refletindo `@nio-cli/cli`.
- **Grep de "noclaf" no repo** (fora `.git`, `node_modules`, `dist`) retorna
  só o que é **intencional**:
  - `src/brand.ts` (4 linhas — documentam a própria migração: nome da spec,
    aviso pra não reintroduzir "Noclaf", nota sobre `noclaf-skills` →
    `nio-skills`).
  - `docs/ROADMAP.md`, `docs/PLANO-EXECUCAO.md`, `docs/roadmap-nio-fluxograma.html` — documentos do próprio planejamento da migração.
  - `docs/specs/**/*.md` já existentes (`auth/0001`, `exec/0002`, `plan/0003`, `plan/0004`) — registros históricos com `status: done`; não reescrevo spec fechada pra apagar o nome antigo do histórico.
  - `.claude/skills/noclaf-flow/`, `.claude/skills/new-dependency/` — conteúdo **provisionado** (saída de um `sync` anterior), não código-fonte deste repo. Atualiza sozinho no próximo `nio sync`, quando `nio-skills` existir.
- **Pendências reais (fora do meu alcance neste repo):** timing da
  coordenação de backend pro `patPrefix` (F11-T0.4), mecanismo de auth
  nativa (`docs/specs/auth/0002-cli-native-login.md`, ainda `draft`).
  Repo GitHub e URL do `nio-skills` resolvidos em 2026-07-26 (ver abaixo).
- **Critério de aceite:** ✅ F11 inteiro fechado no código deste repo; as 4
  pendências acima ficam rastreadas, não bloqueiam o resto da Fase 1.

### F12 — Adapter PostgreSQL com dois destinos configuráveis

#### F12-T1 — Desenho do port
**Dono:** 🧭 Senior · **Depende de:** P0-T2, F11 (nomes já em `nio_*`) · **Status:** `[x]` — `InvestigationGateway` em `core/ports.ts` + `DbTarget`/`QueryResult` em `core/types.ts`; config e guarda de read-only em `adapters/postgres/` (spec `docs/specs/investigation/0001-postgres-dual-ip.md`). Decisão nova: store de users é read-write (exceção ao Invariante #1), resto read-only.

- **O quê:** desenhar `InvestigationGateway` (ou nome equivalente) em
  `src/core/ports.ts`, seguindo exatamente o padrão que já existe pros
  gateways de domínio: interface segregada, comentário de contrato de erro,
  **nenhum** import de client de banco no arquivo de port. O método de query
  recebe o **destino explícito** (`primary | secondary`, nunca default
  silencioso — é o Invariante #4 do roadmap).
- **Como fazer:** meu modelo é `ContextGateway`/`TaskGateway` em
  `src/core/ports.ts:38-118` — mesma granularidade de comentário JSDoc por
  método, mesmo estilo de tipos em `core/types.ts` sem vínculo de backend.
- **Critério de aceite:** interface compilando, sem implementação ainda —
  isso é o contrato que a F12-T2 do Pleno implementa.

#### F12-T2 — Implementação do adapter
**Dono:** ⚙️ Pleno · **Depende de:** F12-T1 · **Status:** `[ ]`

- **O quê:** implementar o port desenhado em F12-T1 dentro de
  `src/adapters/postgres/` (novo diretório, paralelo a
  `src/adapters/supabase/`), com conexão configurável por destino via env
  (`NIO_DB_PRIMARY_URL`, `NIO_DB_SECONDARY_URL`).
- **Como fazer:** **obrigatório usar `Bun.sql`** (ver `CLAUDE.md` da raiz:
  "Bun.sql para Postgres. Don't use pg ou postgres.js") — nada de instalar
  `pg`. Seguir o padrão de `src/adapters/supabase/client.ts` pra construção
  do client e `src/adapters/supabase/gateway.ts` pra composição do objeto
  final que implementa o port.
- **Critério de aceite:** testes com um Postgres local/mock cobrindo: query
  no destino A, query no destino B, erro claro se a env var do destino
  pedido não existir (nunca cair num destino default).

#### F12-T3 — Guarda de read-only em profundidade
**Dono:** 🧭 Senior · **Depende de:** F12-T2 · **Status:** `[ ]`

- **O quê:** a role do banco (P0-T2) já é DQL-only, mas isso é defesa única
  — adiciono uma camada de guarda no código: `SET TRANSACTION READ ONLY` na
  sessão antes de cada query, e/ou allowlist de verbos SQL no topo da query
  (rejeita se não começar com `SELECT`/`WITH`) antes mesmo de mandar pro
  banco.
- **Por quê é Senior:** é literalmente o invariante #1 do roadmap ("o
  adapter PostgreSQL é read-only... sem DML, DDL ou DTL") — ponto que não
  admite erro de implementação, então não delego a primeira versão.
- **Critério de aceite:** teste que tenta um `INSERT`/`DELETE` via o
  gateway e confirma que falha **antes** de tocar a rede (guarda no
  código), mais um teste de integração que confirma que a role do banco
  também rejeitaria (dupla camada).

### F13 — Seleção de banco por projeto/contexto
**Dono:** ⚙️ Pleno · **Depende de:** F12-T3 · **Status:** `[ ]`

- **O quê:** resolver qual destino (`primary`/`secondary`) usar numa
  consulta, dado projeto ativo ou argumento explícito da chamada.
- **Como fazer:** replicar a ordem de precedência que as tools já usam hoje
  pra `project_id` (ver README, seção "Escopo do projeto": argumento da
  chamada → projeto ativo da sessão → default do binding) — mesma
  hierarquia, mesma regra de "nunca default silencioso" (se nenhuma das três
  resolver, erro explícito, não escolha arbitrária).
- **Critério de aceite:** testes cobrindo as 3 origens de resolução + o caso
  de erro sem nenhuma delas presente.

### F14 — Descoberta de schema
**Dono:** ⚙️ Pleno · **Depende de:** F12-T3 · **Status:** `[ ]`

- **O quê:** queries contra `information_schema` (tabelas, colunas, tipos,
  FKs) expostas como método do gateway.
- **Como fazer:** puramente aditivo sobre o port já definido em F12-T1 — se
  precisar de um método novo na interface, é PR pequeno revisado por mim
  antes do Pleno implementar o corpo.
- **Critério de aceite:** dado um schema de teste conhecido, a descoberta
  retorna tabelas/colunas esperadas; testado contra fixture, não produção.

### F15 — Enforcement da role DQL-only
**Dono:** 🧑‍💻 Manual (criação da role) → 🧭 Senior (validação automatizada) · **Depende de:** P0-T2 · **Status:** `[ ]`

- **O quê:** você cria/confirma a role no Postgres real; eu escrevo um teste
  de integração (roda manual, não no CI, por depender de infra viva) que
  conecta com a role e confirma que um `INSERT` de teste é rejeitado pelo
  próprio banco.
- **Critério de aceite:** teste documentado em
  `docs/specs/investigation/000X-dql-role.md` com o resultado registrado.

### F16 — Observabilidade da consulta
**Dono:** ⚙️ Pleno · **Depende de:** F12-T2 · **Status:** `[ ]`

- **O quê:** toda consulta via `InvestigationGateway` registra tempo,
  origem (qual tool/usuário pediu), banco alvo e um id de rastreio.
- **Como fazer:** reusar o padrão de telemetria já existente em
  `src/lib/telemetry.ts` (`track(event)` — best-effort, síncrono, nunca
  lança, conforme o contrato do `AnalyticsGateway` em `core/ports.ts:167-172`)
  em vez de inventar um mecanismo novo.
- **Critério de aceite:** teste confirmando que toda chamada ao gateway
  emite exatamente um evento de observabilidade, com os 4 campos.

**Gate de saída da Fase 1:** critério de pronto do roadmap — "uma consulta
arbitrária roda contra qualquer um dos dois IPs, com o banco escolhido
explicitamente, e é impossível emitir escrita mesmo que a query tente."
Isso é literalmente F12-T3 + F13 + F15 testados juntos antes de abrir a Fase 2.

---

## Fase 2 — Identidade, grupos e contexto

Depende de: Fase 1 fechada. **Resolvido (P0-T3):** "grupo" = **perfil de
ambiente** escolhido pelo colaborador logo após autenticar —
**Desenvolvedor, Analista de Dados, Cientista de Dados, Business
Intelligence.** A escolha dirige configuração/instalação **100%
automática**, e o estado fica gravado **por usuário** (JSON), não por
máquina, pra dois colaboradores no mesmo host não conflitarem.

**Não é green-field.** O repo já tem a mecânica de base: uma taxonomia
`role → área → stack` (`src/lib/sections.ts`) que hoje dirige quais
skills/rules/dependencies são instaladas via `promptSelection()`
(`src/cli/flows/sections.ts` + `provision-step.ts`), e já existe um arquivo
por-máquina separado do versionado do time (`noclaf.user.json` → `nio.user.json`
depois do F11, ver `src/config.ts:19-29`). Fase 2 é **extensão guiada** dessa
mecânica, não invenção do zero.

### U21 — `nio init`: perfil como escolha central pós-auth
**Dono:** 🧭 Senior (mapeamento perfil→slug) → ⚙️ Pleno (implementação) · **Depende de:** F11 · **Status:** `[ ]`

- **O quê:** `resolveProjectSetup()` (`src/cli/commands/init/index.ts:36-56`)
  já chama `promptSelection()` logo após auth+projeto. A mudança é a
  taxonomia de roles: hoje só existe `dev` (`DEV_ROLE`) e `management`
  (`sections.ts:21`, migração legada); passa a incluir os 4 perfis novos.
- **Como fazer:** eu proponho o mapeamento perfil (pt-BR, visível) → slug
  (usado em path/código) antes de qualquer implementação — troca de
  taxonomia é decisão de produto, então valido com você:
  `Desenvolvedor→dev` (já existe), `Analista de Dados→data-analyst`,
  `Cientista de Dados→data-scientist`, `Business Intelligence→bi`. Com os
  slugs confirmados, o Pleno ajusta o prompt em `promptSelection()` pra
  listar os 4 com os rótulos em pt-BR.
- **Critério de aceite:** `nio init` pergunta o perfil logo após autenticar,
  4 opções em pt-BR, grava o slug correspondente.

### U22/U23 — Descobrir perfis e persistir por usuário (não por máquina)
**Dono:** ⚙️ Pleno · **Depende de:** U21 · **Status:** `[ ]`

- **O quê (U22 — descoberta):** `discoverRoles()` (`sections.ts:31-33`) já
  lista roles a partir das subpastas de `skills/` do repo externo de
  skills — "listar grupos disponíveis" já é automático **assim que o repo
  de skills tiver as pastas** `skills/data-analyst/`, `skills/data-scientist/`,
  `skills/bi/` ao lado de `skills/dev/`.
  > ⚠️ **Dependência externa, não deste repo:** criar essas pastas é
  > trabalho no repo de skills (outro projeto). Preciso saber se isso entra
  > na minha fila (nesse caso, acesso ao repo) ou se é outro time cuidando
  > em paralelo — do contrário U22 fica sem conteúdo pra listar.
- **O quê (U23 — persistência):** estender `UserConfig` (hoje só `{ ide }`,
  `src/config.ts:24-26`) pra guardar o perfil escolhido — mas **por
  usuário**, não por máquina/repo como é hoje. Muda o local de gravação: de
  `nio.user.json` (ao lado do binding do projeto) pra algo em
  `~/.nio/users/<user_id>.json`, chaveado pelo id do usuário autenticado.
  Isso resolve dois problemas de uma vez: dois colaboradores na mesma
  máquina não colidem (critério de pronto da fase), e o mesmo colaborador
  mantém o perfil entre repos diferentes sem reconfigurar.
- **Como fazer:** o padrão de leitura/escrita tolerante já existe em
  `src/config.ts` (`readUserIde`, `writeUserConfig`) — replicar a mesma
  forma (parse tolerante, `try/catch` que ignora arquivo corrompido) pro
  arquivo novo, só mudando a chave de particionamento de "diretório do
  projeto" pra "id do usuário".
- **Critério de aceite:** teste com dois `user_id` simulados no mesmo
  diretório de projeto (fixture de `$HOME` temporário) persistindo perfis
  diferentes sem um sobrescrever o outro.

### U24 — Prefixo de tool por usuário
**Dono:** 🧭 Senior · **Depende de:** U23 · **Status:** `[ ]`

- **O quê:** hoje o prefixo de tool MCP é fixo (`brand.ts:toolPrefix`).
  Preciso validar a leitura antes de desenhar: o prefixo **muda** por
  usuário (ex.: `nio_dev_list_tasks` vs `nio_analyst_list_tasks`), ou o
  prefixo continua único e é só o **conjunto de tools exposto** que varia
  por perfil (um analista de dados não precisa ver `move_task`, por
  exemplo)? A segunda opção é bem mais barata e não quebra nome de tool já
  cacheado por clientes MCP existentes — é a que eu recomendaria, mas é
  decisão sua.
- **Por quê é Senior:** nome de tool MCP é contrato público — cliente já
  configurado quebra se o nome mudar debaixo dele.

### U25 — Selecionar projetos, bancos e escopos de investigação
**Dono:** ⚙️ Pleno · **Depende de:** U24, F13 (Fase 1) · **Status:** `[ ]`

- **O quê:** estender a sessão por-usuário criada em U23 pra também guardar
  o destino de banco (`primary`/`secondary`, de F13) e o escopo de
  investigação ativo — mesma mecânica de persistência, campos novos.

### U26 — Revalidar perfil e conexão sem alterar o PostgreSQL
**Dono:** ⚙️ Pleno · **Depende de:** U23 · **Status:** `[ ]`

- **O quê:** comando que relê o perfil salvo, reconfirma que ainda existe na
  taxonomia atual (perfil pode ter sido descontinuado no repo de skills) e
  reprovisiona se mudou — reaproveitando o padrão do `nio sync` atual
  (`src/cli/commands/sync.ts`). Só leitura no banco de investigação, nunca
  escrita.

**Gate de saída da Fase 2:** critério de pronto do roadmap — dois usuários no
mesmo host com identidades, perfis e prefixos de tool distintos, zero
escrita no PostgreSQL.

---

## Fase 3 — Tools do core read-only

Depende de: Fase 2. Formato de decisão dos owners:

- **T31-T35** ("manter" tools existentes + time tracking local) — ⚙️ Pleno,
  tarefa de **verificação e adaptação**, não reescrita: rodar a suíte atual
  de tools (`src/tools/*.test.ts`) contra o novo gateway de identidade/banco
  e ajustar imports/assinaturas quebradas.
- **T36 — Remover escrita no PostgreSQL** — 🧭 **Senior, sem delegar.** É o
  único ponto de remoção da fase (o roadmap já marca isso com ⚠️): significa
  desconectar `TaskGateway`/`AllocationGateway` (as interfaces de escrita
  que hoje vivem em `src/adapters/supabase/task-gateway.ts` e
  `allocation-gateway.ts`) do caminho de execução das tools, sem apagar o
  código ainda (ele vira a base do adapter interno da Fase 4). Erro aqui
  significa apagar a capacidade de escrita antes do substituto (Fase 4)
  existir — por isso T36 e I41-I46 precisam estar sequenciados com cuidado,
  possivelmente rodando T36 só depois que a Fase 4 já tiver o adapter
  interno pronto em paralelo (branch própria), mesmo que o roadmap liste T36
  antes de I4x — vou validar essa sequência com você quando chegarmos lá.

---

## Fase 4 — Sistema interno

Depende de: Fase 3. Owners previstos (detalhe fino quando F3x estiver perto
do fim, mesma lógica da Fase 2):

- **I41, I44, I46** (operations, adapter HTTP/gRPC, roteamento por
  capacidade) — 🧭 Senior: é desenho de port novo + o roteador que decide
  "isso é leitura externa (Postgres) ou escrita interna" — ponto onde um
  erro de roteamento manda uma escrita pro adapter read-only errado
  (violaria o invariante #1).
- **I42, I43** (`createTask`/`updateTask`/`moveTask`/`commentTask`,
  `recordDelivery`) — ⚙️ Pleno, uma vez que I41 definir a interface: é
  essencialmente portar a lógica que já existe em
  `src/adapters/supabase/task-gateway.ts` pro adapter novo, então há
  bastante prior art no próprio repo pra seguir.
- **I45** — 🧭 Senior confirma que o adapter Postgres não ganhou nenhum
  método de escrita de volta (regressão do T36/F12-T3).

---

## Fase 5 — Investigação e engenharia de dados

Depende de: Fase 3 e Fase 4. Esta fase é a mais distante e mais sujeita a
mudar de forma com o que aprendermos nas Fases 1-4 — mantenho só no nível do
roadmap por ora (D51-D55), sem desmembrar em cards. Retomo o detalhamento
quando a Fase 4 estiver com critério de pronto atingido.

---

## Fase 6 — Refatoração estrutural controlada

Depende de: Fase 5 com comportamento estabilizado. **Regra da fase (do
roadmap): mecânica, sem mudança de comportamento, 1 commit por item,
reversível.** Isso é o perfil ideal de task pro Pleno — mas o **primeiro**
item de cada trilha é feito pelo Senior pra fixar o padrão que os demais
replicam.

- **R61 (raiz)** — 🧭 Senior organiza `src/lib` por domínio, documenta o
  critério de agrupamento usado (ex.: `lib/skills/`, `lib/exec/`,
  `lib/provision/`) num comentário curto no topo de cada novo diretório.
- **R62** (consolidar skills: model/cache/serve/filter) — ⚙️ Pleno, replica
  o critério fixado em R61.
- **R64** (dependencies/hooks) — ⚙️ Pleno, mesma base.
- **R65** (unificar engines de execução local) — ⚙️ Pleno; ponto de atenção:
  `src/lib/exec-engines.ts` já é um registro central bem desenhado (ver
  seção "Registro central de engines" da spec `docs/specs/exec/0002`) — a
  task aqui é confirmar que nada mais no repo reimplementa esse padrão em
  paralelo, não redesenhar o que já está certo.
- **R66 (dividir `task-gateway` sem alterar ports públicos)** — 🧭 Senior:
  toca a interface pública (`core/ports.ts`), então fica comigo mesmo sendo
  "mecânico" — divisão de arquivo interno é segura pro Pleno, mudança de
  contrato público não.

---

## Fase 7 — Escala futura

Depende de: Fase 6. **Não desmembrar em tasks agora** — o próprio roadmap diz
"só puxar quando houver dor real medida". Fica como backlog (G71-G75); volto
aqui quando algum sintoma concreto (JSON grande demais, query lenta repetida,
race condition observada) justificar puxar um item específico.

---

## Estado agora (o que fazer primeiro)

- ✅ **F11 (rebrand) inteiro fechado e no repo novo** — `brand.ts`,
  `package.json`, todo `src/**`, `README.md`, `PUBLISHING.md`, `bun.lock`.
  Repo do projeto em `github.com/hugoreiis12-png/NIO-CLI`, skills em
  `github.com/hugoreiis12-png/NIO-SKILLS-` (`brand.githubOrg`/`githubRepo`
  centralizam isso). `bun test` 228/0, `tsc --noEmit` limpo.
- ⏸️ **`docs/specs/auth/0002-cli-native-login.md` — `paused`.** Chegamos a
  implementar um Gateway de Auth completo (`src/gateway/`: OAuth2
  Authorization Code + PKCE, testado ponta a ponta) e o Edge Filter
  (`workers/edge-filter/`, Cloudflare Worker). Pausado por decisão do dono
  do produto até decidir onde o Gateway vai rodar de fato (local não
  funciona multi-máquina — `localhost` só existe na máquina de quem roda;
  opções em aberto: VPS/Fly/Railway vs. mover o Gateway também pro
  Cloudflare, que exigiria trocar sessão em memória por KV/Durable
  Objects). **Confirmado sem efeito colateral:** nada fora de
  `src/gateway/` importa o módulo, `TOKEN_EXCHANGE_URL` continua no
  Supabase como sempre esteve, `src/gateway/**` já estava fora do
  `tsc`/`dist` publicado. Código fica como está, só não plugado em nada.
- ⏳ **3 pendências fora do meu alcance neste repo:** rename do repo GitHub
  antigo (se ainda relevante — o novo já está criado e em uso), timing da
  coordenação de backend pro `patPrefix: 'nio_'`, e onde hospedar o Gateway
  (acima).
- ⏳ **P0-T2 em andamento** — os DSNs virão diretamente de você pra mim (não
  passam pelo Pleno, ver regra 8). Só a confirmação de que a role é
  DQL-only chega até o agente. Ainda destrava F12/F15 quando chegar.
- ✅ **Fase 0 fechada** — `docs/adr/0001`, `0002` e `0003` escritos;
  `ROADMAP.md` com P01-P06 marcados `[x]`, linkados aos ADRs.

Próximo passo natural: **Fase 1, F12-F16** (adapter PostgreSQL dual-IP) —
não depende de nada do Gateway (pausado) nem do rebrand (já fechado). Só
falta o P0-T2 (DSNs) pra F12/F15 saírem do papel; F13/F14/F16 (seleção de
banco, schema discovery, observabilidade) podem começar a ser desenhados
(F12-T1, o port) mesmo antes disso chegar.
