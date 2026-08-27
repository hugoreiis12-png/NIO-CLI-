# NIO-CLI — Documento de Transição v1 → v2

> **Status:** Em refatoração  
> **Branch:** `refactor/gateway-port`  
> **Autor:** Hugo Reis  
> **Data:** Agosto/2026

---

## 1. Visão Geral da Transição

| | NIO-CLI v1 (Legado) | NIO-CLI v2 (Novo) |
|---|---|---|
| **Propósito** | Cliente do sistema interno NOS (tarefas, sprints, ponto, cronometragem) | Orquestrador de ambientes de desenvolvimento personalizados por sessão |
| **Usuário-alvo** | Time interno que gerencia projetos no NOS | Full Stacks, Analistas, Cientistas, DBAs, QAs e BIs |
| **Entidade central** | `Project` (vínculo ao NOS) | `Session` (ambiente isolado, ID único, persistido no Postgres) |
| **Interação principal** | CLI executa comandos no NOS + MCP expõe tools de gestão | Wizard interativo configura ambiente + IA materializa via MCP |
| **Backend** | Supabase (PostgREST + RLS) | PostgreSQL dedicado (`nio_cli`) |
| **Deploy** | Pacote npm global (`nio` / `nio-cli`) | Pacote npm global (mesmo binários, domínio completamente novo) |

---

## 2. O que o projeto ERA (v1 — Legado NOS)

### 2.1 Propósito original
A NIO-CLI era a **ponte entre o terminal do desenvolvedor e o sistema NOS** (Núcleo Operacional de Inteligência). O NOS era uma plataforma interna de gestão de projetos com:

- Kanban de tarefas e sprints
- Controle de ponto (entrada/saída)
- Cronometragem por tarefa
- Registro de entregas (PRs, tickets)
- Gestão de skills e documentação

### 2.2 Funcionalidades existentes

| Funcionalidade | Descrição |
|---|---|
| `nio init` | Vinculava o repo local a um projeto no NOS |
| `nio login` | Autenticação via PAT → JWT no Supabase |
| `nio sync` | Baixava skills do repo `NIO-SKILLS-` e provisionava nos clientes MCP (Claude Code, Codex, Cowork) |
| `nio plan` | Engine pensante para planejamento de tarefas |
| `nio exec` | Delegava implementação a agentes headless |
| `nio validate-plan` | Validava plano pré-SDD |
| `nio clean-legacy` | Limpava arquivos antigos de skills |
| **20 tools MCP** | `get_context`, `list_tasks`, `create_task`, `move_task`, `start_allocation`, `end_allocation`, `record_delivery`, etc. |

### 2.3 Stack técnica legada

```
Runtime:     Node.js 20+ / Bun
Linguagem:   TypeScript 5.4+
Backend:     Supabase (PostgREST + RLS)
Auth:        PAT → JWT (com refresh proativo/reativo)
CLI:         commander + @clack/prompts + chalk/boxen
MCP:         @modelcontextprotocol/sdk
Build:       tsc puro → dist/
Edge:        Cloudflare Worker (workers/edge-filter/)
```

### 2.4 Arquitetura legada

```
┌─────────────┐     ┌─────────────┐     ┌─────────────────┐
│   CLI /     │────▶│  Session    │────▶│  Supabase       │
│   MCP       │     │  Factory    │     │  (PostgREST)    │
│   Server    │     │             │     │                 │
└─────────────┘     └─────────────┘     └─────────────────┘
                           │
                    ┌──────┴──────┐
                    ▼             ▼
              ┌─────────┐  ┌──────────┐
              │  Tools  │  │  Skills  │
              │  (20x)  │  │  Cache   │
              └─────────┘  └──────────┘
```

- **Hexagonal** com ports/adapters, mas o domínio era 100% NOS
- **Gateway OAuth local** (Bun.serve na porta 8787) para login nativo futuro
- **Skills cache** em `~/.nio/skills` (zipball do GitHub)
- **Provisionamento** de skills nos 3 clientes MCP (Claude Code, Codex, Cowork)

---

## 3. O que o projeto IRÁ SE TORNAR (v2 — Orquestrador de Ambientes)

### 3.1 Nova visão de produto

> **"Cada desenvolvedor tem um ambiente único. A NIO-CLI materializa esse ambiente em segundos."**

A CLI deixa de ser um **cliente de sistema** e passa a ser um **orquestrador de ambientes de desenvolvimento**. O usuário escolhe seu perfil, responde um wizard de personalização, e a CLI (com auxílio da IA via MCP) configura tudo: toolchains, linguagens, frameworks, MCPs, SDKs, plugins, dotfiles, aliases e IDE.

### 3.2 Perfis disponíveis (fixos no código fonte)

| Perfil | Foco | Exemplo de wizard |
|---|---|---|
| **Full Stack** | Desenvolvimento web/mobile | Tendência (front/back/full) → Linguagem → Framework → Pasta → IDE |
| **Analista de Dados** | ETL, visualização | Linguagem (Python/SQL/R) → Ferramentas → Pasta → IDE |
| **Cientista de Dados** | ML, estatística | Linguagem (Python/Julia/R) → Framework ML → Pasta → IDE |
| **DBA** | Administração de banco | Linguagem (SQL/Bash/Python) → Cliente DB → Pasta → IDE |
| **QA Manager** | Testes automatizados | Linguagem (TS/Python/Java) → Framework de teste → Pasta → IDE |
| **BI** | Dashboards e relatórios | Linguagem (SQL/Python/DAX) → Tool de BI → Pasta → IDE |

> **Nota:** Novos perfis só podem ser adicionados alterando o código fonte da CLI.

### 3.3 Conceito de Sessão

Cada execução do `nio init` cria uma **sessão** — um ambiente de desenvolvimento isolado com ID único.

```
Sessão #a1b2c3d4
├── Perfil: fullstack
├── Tendência: full
├── Linguagens: [typescript, python]
├── Toolchains: [node, docker, git]
├── MCPs: [web-search, browser-tools]
├── Frameworks: [nextjs]
├── Project path: ~/projetos/meu-app
├── IDE: vscode
├── Env vars: { NODE_ENV: dev }
├── Aliases: { nr: "pnpm run" }
└── Status: active
```

**Regras da sessão:**
- Cache local de até **10 dias** (`~/.nio/sessions/`)
- Após 10 dias, fica apenas no Postgres (pode ser reativada)
- Usuário pode ter N sessões, mas só **1 ativa por vez**
- Sessões podem **concatenar/compartilhar** configurações entre si

### 3.4 Watcher de dependências (auto-magia)

A cada **10 segundos**, a CLI escaneia o `projectPath` da sessão ativa:

1. Detecta novas dependências em arquivos de config (`package.json`, `requirements.txt`, `Cargo.toml`, etc.)
2. Se encontrar algo não instalado/configurado → **instala automaticamente**
3. Sem pedir permissão do usuário (reconhecimento de ambiente contínuo)

### 3.5 Nova stack técnica

```
Runtime:     Node.js 20+ (compatível com Bun, mas não depende)
Linguagem:   TypeScript 5.5+
Backend:     PostgreSQL 16 (dedicado, via driver pg)
Auth:        Usuário/senha no Postgres (futuro: JWT local)
CLI:         commander + @clack/prompts + chalk/boxen
MCP:         @modelcontextprotocol/sdk (novas tools de ambiente)
Build:       tsc puro → dist/
Cache:       Local filesystem (~/.nio/sessions/) + Postgres
```

### 3.6 Nova arquitetura

```
┌─────────────────────────────────────────────────────────────┐
│                    ENTRYPOINTS                              │
│  ┌─────────────┐              ┌─────────────────────────┐   │
│  │  nio (CLI)  │              │  nio-cli (MCP Server)   │   │
│  │  commands   │              │  tools de ambiente      │   │
│  └─────────────┘              └─────────────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│                    CAMADA DE APLICAÇÃO                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐│
│  │SessionManager│  │Environment  │  │ DependencyWatcher   ││
│  │(CRUD sessões)│  │Builder      │  │ (scan 10s)          ││
│  └─────────────┘  └─────────────┘  └─────────────────────┘│
├─────────────────────────────────────────────────────────────┤
│                    CAMADA DE DOMÍNIO (core/)                 │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  PORTS: SessionRepository, EnvironmentGateway,          ││
│  │         ToolchainGateway, ProfileCatalog,               ││
│  │         SessionCache, DependencyWatcher, IdeGateway     ││
│  └─────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────┐│
│  │  ENTIDADES: Session, EnvironmentConfig, Profile,        ││
│  │            SessionLog, SessionActivity, UserCli         ││
│  └─────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────┤
│                    ADAPTERS                                 │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐           │
│  │ adapters/pg│  │adapters/fs │  │adapters/pkg│           │
│  │ (Postgres) │  │ (local)    │  │ (npm,pip)  │           │
│  └────────────┘  └────────────┘  └────────────┘           │
│  ┌────────────┐  ┌────────────┐                          │
│  │adapters/ide│  │profiles/   │                          │
│  │ (vscode)   │  │ (hardcoded)│                          │
│  └────────────┘  └────────────┘                          │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Roadmap de Implementação (Sprints)

### 🎯 Sprint 0 — Fundação (Limpeza + Base)
**Duração:** 1-2 dias  
**Objetivo:** Ter um repo limpo com a nova arquitetura compilando.

| # | Task | Critério de aceitação |
|---|------|----------------------|
| 0.1 | Criar database `nio_cli` no Postgres e aplicar `schema.sql` | `\dt` mostra as 5 tabelas |
| 0.2 | Instalar `pg` e `@types/pg` no projeto | `package.json` atualizado |
| 0.3 | Remover código legado NOS (lista completa no PLANO_REMOCAO.md) | Build passa sem erros de import faltante |
| 0.4 | Copiar novos arquivos de domínio (`core/types.ts`, `core/ports.ts`, `profiles/catalog.ts`) | `npx tsc --noEmit` passa |
| 0.5 | Copiar adapters (`pg/client.ts`, `pg/session-repository.ts`, `local/session-cache.ts`) | Teste de conexão ao Postgres passa |
| 0.6 | Substituir `session-factory.ts` pela nova fábrica | Factory inicializa sem erro |
| 0.7 | Atualizar `package.json` (remover Supabase, adicionar pg) | `npm install` funciona |
| 0.8 | Reescrever `src/tools/index.ts` (esqueleto vazio das novas tools) | Compila sem erro |

---

### 🎯 Sprint 1 — CLI Core (Comandos de Sessão)
**Duração:** 3-4 dias  
**Objetivo:** O usuário consegue criar, listar, ativar e arquivar sessões via terminal.

| # | Task | Critério de aceitação |
|---|------|----------------------|
| 1.1 | Implementar `nio init` — wizard interativo com `@clack/prompts` | Usuário responde perfil → linguagem → pasta → IDE e sessão é criada no Postgres |
| 1.2 | Implementar `nio session list` | Lista todas as sessões do usuário (merge cache + Postgres) |
| 1.3 | Implementar `nio session activate <id>` | Ativa sessão, arquiva outras ativas do mesmo user |
| 1.4 | Implementar `nio session archive <id>` | Arquiva sessão (status = archived) |
| 1.5 | Implementar `nio session delete <id>` | Remove do Postgres e do cache local |
| 1.6 | Implementar `nio --version` e `nio --help` atualizados | Mostra versão 2.0.0 e comandos disponíveis |

---

### 🎯 Sprint 2 — Materialização do Ambiente
**Duração:** 4-5 dias  
**Objetivo:** A sessão criada no Sprint 1 ganha "vida" — toolchains instalados, dotfiles criados, IDE aberta.

| # | Task | Critério de aceitação |
|---|------|----------------------|
| 2.1 | Implementar `ToolchainGateway` (detectar/instalar: Node, Python, Go, Rust, Docker, Git) | `nio env install node` funciona no terminal |
| 2.2 | Implementar `IdeGateway` (abrir VS Code, Cursor, terminal) | `nio env open` abre a IDE na pasta do projeto |
| 2.3 | Implementar geração de dotfiles (`.zshrc`, `.env`, etc.) por perfil | Arquivos são criados na pasta do projeto |
| 2.4 | Implementar configuração de aliases de shell por perfil | Aliases funcionam no terminal da sessão |
| 2.5 | Implementar `EnvironmentGateway.materialize(session)` | Orquestra instalação de tudo de uma vez |
| 2.6 | Integrar materialização no final do `nio init` | Após o wizard, o ambiente é materializado automaticamente |

---

### 🎯 Sprint 3 — Watcher de Dependências
**Duração:** 3-4 dias  
**Objetivo:** A CLI detecta e instala dependências automaticamente a cada 10 segundos.

| # | Task | Critério de aceitação |
|---|------|----------------------|
| 3.1 | Implementar scanner de `package.json` (npm) | Detecta novas dependências não instaladas |
| 3.2 | Implementar scanner de `requirements.txt` (pip) | Detecta novas dependências não instaladas |
| 3.3 | Implementar scanner de `Cargo.toml` (cargo) | Detecta novas dependências não instaladas |
| 3.4 | Implementar auto-instalação (roda `npm install`, `pip install`, etc.) | Dep detectada é instalada sem pedir permissão |
| 3.5 | Implementar watcher com intervalo de 10s | Processo roda em background durante sessão ativa |
| 3.6 | Implementar `nio env detect` (scan manual) | Usuário pode forçar scan a qualquer momento |
| 3.7 | Persistir eventos de dependência no Postgres | Tabela `dependency_events` populada |

---

### 🎯 Sprint 4 — MCP Server (Tools de Ambiente)
**Duração:** 3-4 dias  
**Objetivo:** A IA (Claude, Codex, etc.) consegue interagir com o ambiente via MCP.

| # | Task | Critério de aceitação |
|---|------|----------------------|
| 4.1 | Implementar `nio_session_create` (tool MCP) | IA cria sessão com parâmetros |
| 4.2 | Implementar `nio_session_list` (tool MCP) | IA lista sessões do usuário |
| 4.3 | Implementar `nio_session_activate` (tool MCP) | IA ativa sessão por ID |
| 4.4 | Implementar `nio_env_materialize` (tool MCP) | IA força materialização do ambiente |
| 4.5 | Implementar `nio_env_detect_deps` (tool MCP) | IA força scan de dependências |
| 4.6 | Implementar `nio_profile_get` (tool MCP) | IA consulta catálogo de perfis disponíveis |
| 4.7 | Testar integração com Claude Code / Codex | Tools aparecem e funcionam nos clientes MCP |

---

### 🎯 Sprint 5 — Sincronização e Integração NIO-SKILLS ✅ CONCLUÍDO (27 ago 2026)
**Objetivo:** A CLI se alimenta do repo NIO-SKILLS para enriquecer o ambiente.

| # | Task | Estado |
|---|------|--------|
| 5.1 | Fetch do repo NIO-SKILLS (zipball GitHub) → `~/.nio/skills/` | ✅ `fetchSkills` (herdado do v1) |
| 5.2 | Parser de receitas de ambiente (`recipes/<slug>.md` → `EnvironmentRecipe`) | ✅ `RecipeCatalog` (`src/adapters/skills/recipe-catalog.ts`) |
| 5.3 | Receitas no wizard de `nio init` (+ merge no `EnvironmentBuilder`) | ✅ `pickRecipe` + `build(profile, recipe?)` + arg na tool `nio_session_create` |
| 5.4 | `nio sync` — sincroniza a recipe da sessão ativa | ✅ oferta de re-materialização (best-effort) |
| 5.5 | Cache de skills com TTL | ✅ `SKILLS_TTL_MS` 7d em `ensureSkillsCache()` |

> Nota: a "receita" aqui é `EnvironmentRecipe` — preset nomeado do repo NIO-SKILLS
> que **estende** um perfil fixo (nunca cria perfil). Não confundir com a
> `LanguageRecipe` do `nio-lang` (hardcoded, nível-SDK). Detalhe em
> `docs/v2/PROGRESSO.md` (entrada de 27 ago). A integração das skills de
> engenharia de `mattpocock/skills` foi avaliada e adiada como melhoria futura
> (camada NIO-SKILLS, nunca no motor da CLI).

---

### 🎯 Sprint 6 — Polish e Lançamento
**Duração:** 2-3 dias  
**Objetivo:** CLI estável, testada e documentada para uso.

| # | Task | Critério de aceitação |
|---|------|----------------------|
| 6.1 | Escrever testes unitários para adapters PG | Cobertura > 60% nos adapters |
| 6.2 | Escrever testes de integração para `nio init` | Fluxo completo passa em CI |
| 6.3 | Documentar comandos no README.md | Cada comando tem exemplo de uso |
| 6.4 | Criar script de migração de schema do Postgres | `npm run db:migrate` aplica migrations |
| 6.5 | Publicar versão 2.0.0 no npm | `npm publish` bem-sucedido |
| 6.6 | Tag `v2.0.0` no GitHub | Release notes escritas |

---

## 5. Dependências entre Sprints

```
Sprint 0 (Fundação)
    │
    ▼
Sprint 1 (CLI Core) ─────┐
    │                    │
    ▼                    ▼
Sprint 2 (Materialização) Sprint 3 (Watcher)
    │                    │
    └────────┬───────────┘
             ▼
      Sprint 4 (MCP Server)
             │
             ▼
      Sprint 5 (NIO-SKILLS)
             │
             ▼
      Sprint 6 (Polish)
```

**Regra:** Sprint N só começa quando Sprint N-1 está 100% funcional (não precisa estar perfeito, mas precisa compilar e os critérios de aceitação passarem).

---

## 6. Riscos e Mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Instalação de toolchains falha em diferentes OS | Alta | Alto | Isolar lógica por OS (macOS/Linux/Windows), fallback para manual |
| Watcher de 10s consome muita CPU | Média | Médio | Usar `fs.watch` ou `chokidar` ao invés de polling puro |
| Postgres não acessível (usuário offline) | Média | Alto | Modo offline: cache local funciona sem PG, sincroniza quando voltar |
| MCP tools conflitam com tools antigas nos clientes | Baixa | Médio | Renomear todas as tools com prefixo `nio_` (já feito no design) |
| Perfis hardcoded dificultam manutenção | Baixa | Baixo | Extrair para JSON/YAML no Sprint 5+ se necessário |

---

## 7. Glossário

| Termo | Significado |
|---|---|
| **Session** | Ambiente de desenvolvimento isolado com ID único |
| **Profile** | Perfixo de usuário (Full Stack, Analista, etc.) que define o wizard |
| **Materialize** | Processo de instalar toolchains, criar configs e abrir IDE |
| **Watcher** | Processo de background que escaneia dependências a cada 10s |
| **Recipe** | Configuração pré-definida de ambiente para um perfil + linguagem |
| **Cache local** | Arquivos JSON em `~/.nio/sessions/` com TTL de 10 dias |
| **NIO-SKILLS** | Repo externo de skills/receitas que alimenta a CLI |

---

## 8. Próximo passo imediato

> **Executar o Sprint 0.**

1. Criar o database `nio_cli` no Postgres
2. Aplicar `schema.sql`
3. Limpar código legado
4. Copiar novos arquivos de domínio
5. Validar que `npx tsc --noEmit` passa
6. Testar conexão com Postgres

Após o Sprint 0, o projeto estará pronto para implementar o wizard `nio init` (Sprint 1).
