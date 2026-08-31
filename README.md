# NIO-CLI

**Orquestrador de ambientes de desenvolvimento.** Você escolhe um perfil,
responde um wizard, e a CLI — com auxílio de IA via MCP — materializa o ambiente:
toolchains, linguagens, frameworks, dotfiles, aliases e IDE. A entidade central é
a **Sessão**: um ambiente isolado, com UUID, persistido no Postgres.

> Documentação completa no terminal ou como página: `nio docs` · `nio docs --html --open`.

---

## Como funciona

```
você → nio (CLI) ──► nio-gateway ──► Postgres        (login: senha + JWT, 2º fator opcional)
          │
          ├──► SessionManager / EnvironmentBuilder    (materializa toolchains, MCPs, dotfiles)
          │
          └──► opencode.json  ──►  OpenCode (operador de IA)
                                     └── MCP `nio` (tools nio_*)  ──► SessionManager ──► Postgres
```

1. **Você se autentica** (`nio register` / `nio login`). O `nio-gateway` — um
   serviço HTTP loopback — verifica a senha (argon2id), dispara o 2º fator se
   estiver ativo, e devolve um **JWT** salvo em `~/.nio/session.json`.
2. **Você monta uma sessão** (`nio init`). O wizard pergunta perfil + recipe, e o
   `EnvironmentBuilder` garante os toolchains, resolve os MCPs e grava o `config`
   materializado na linha `sessions` do Postgres. A sessão é isolada, tem UUID e
   pode ser reativada depois (`nio sessions`).
3. **`nio ai` abre a interface NIO** — o Headroom (proxy de compressão, container
   Docker, obrigatório), o `opencode serve` headless (`opencode/big-pickle`, MCP
   `nio` + MCPs do perfil), e a UI do NIO em Ink (chat, sidebar, paleta `/`). Com
   IDE, roda num terminal integrado dela. A partir daí o agente tem as tools
   `nio_*` — criar/ativar sessão, re-materializar ambiente, delegar execução.

O **Postgres é a fonte da verdade** do domínio (usuários, sessões, trilha de
auth). A CLI e o gateway só falam com o banco que **você** configurar — não há
default, não há banco embutido.

---

## Instalação

Precisa de **Node.js 20.12+**. Instala como pacote global:

```bash
npm i -g @nio-cli/cli
```

Ficam no PATH: `nio` (CLI), `nio-gateway` (serviço de auth), `nio-cli` e
`nio-lang` (servidores MCP).

### Pré-requisitos de runtime

| Requisito | Pra quê | Como |
|---|---|---|
| **PostgreSQL** alcançável | fonte da verdade (sessões, usuários) | schema em `db/schema.sql` aplicado uma vez |
| **`JWT_SECRET`** (segredo do time) | assinar/validar as sessões | mesmo valor em toda máquina |
| **OpenCode** | operador de IA | o `nio init` oferece instalar (`npm i -g opencode-ai`) |
| **Docker** | obrigatório pro `nio ai` — roda o Headroom (proxy de compressão) | `docker compose version` |
| *(opcional)* provedor de SMS | 2º fator | `SMS_ENDPOINT_URL` + `SMS_AUTH_HEADER` + `SMS_BODY_TEMPLATE` |

---

## Configuração

**Você não precisa exportar nada no shell.** Rode `nio config setup` — o wizard
pede o `NIO_DATABASE_URL` (que o time te passa) e o `JWT_SECRET`, **testa a
conexão** e grava em `~/.nio/config.env` (chmod 600, nunca commitado). O `nio init`,
`nio register` e `nio login` disparam esse wizard sozinhos se a config faltar; se
estiver presente mas errada, param com uma mensagem dizendo exatamente o quê.

```bash
nio config setup     # wizard interativo (cola os valores, testa, salva)
nio config check     # confere: completa? banco responde?  (--json pra CI)
nio config path      # ~/.nio/config.env
```

A CLI carrega as variáveis nesta precedência (shell sempre vence os arquivos):

```
env do shell  >  $NIO_ENV_FILE  >  ./.env  >  ~/.nio/config.env
```

Conteúdo de `~/.nio/config.env` (o wizard gera; dá pra editar à mão):

```bash
NIO_DATABASE_URL=postgres://usuario:senha@HOST:5432/nio_cli
# NIO_DATABASE_SSL=true          # só se o banco exigir TLS (gerenciado/nuvem)
JWT_SECRET=<mesmo-valor-do-time>

# 2º fator (SMS) — opcional, só no lado do gateway
# SMS_ENDPOINT_URL=https://api.provedor.com/v2/sms
# SMS_AUTH_HEADER=X-API-TOKEN: seu-token
# SMS_BODY_TEMPLATE={"to":"{to}","message":"{text}"}
```

> Alternativa pra time: gere o `~/.nio/config.env` uma vez e distribua o arquivo
> (é só `KEY=value`) — a CLI valida no primeiro comando.

| Variável | Prefixo | Lida por |
|---|---|---|
| `NIO_DATABASE_URL` / `NIO_DATABASE_SSL` | `NIO_` | tudo que toca o banco |
| `JWT_SECRET` / `JWT_EXPIRES_IN` | **sem** prefixo (segredo do time) | `nio-gateway` + `nio-cli` |
| `SMS_ENDPOINT_URL` / `SMS_AUTH_HEADER` / `SMS_BODY_TEMPLATE` / `SMS_FROM` | **sem** prefixo | `nio-gateway` |
| `NIO_GATEWAY_HOST` (default `127.0.0.1`) | `NIO_` | `nio-gateway` — `0.0.0.0` p/ Kong em container |
| `NIO_GATEWAY_URL` (default `http://127.0.0.1:3000`) | `NIO_` | a CLI acha o nio-gateway (Kong na frente = aponta :8000) |

O schema de conexão é sempre `postgres://…`; um destino inválido falha explícito,
nunca cai num default silencioso.

---

## Primeiros passos

Um comando só:

```bash
nio            # (ou `nio start`) — a esteira guiada
```

A esteira detecta em que ponto você está e conduz — **config → gateway → login →
sessão → handoff pro OpenCode** —, perguntando antes de cada passo. Ela sobe o
`nio-gateway` sozinha se faltar. Se você sair no meio, ela imprime a linha exata
pra retomar (`nio start`); nada morre no silêncio.

Por dentro, é isto (cada um roda na mão também):

```bash
nio config setup     # cola NIO_DATABASE_URL + JWT_SECRET (o time te passa), testa, salva
nio-gateway          # gateway de auth (a esteira sobe sozinha se faltar)
nio register         # cria seu usuário na base compartilhada → cai no login
nio login            # autentica (salva o JWT em ~/.nio/session.json)
nio security enable-2fa   # (opcional) 2º fator
nio init             # monta o ambiente da sessão → `nio ai` (Headroom + OpenCode, num terminal da IDE)
```

O `nio-gateway` só é necessário pros comandos de auth (`login`/`logout`/
`verify-2fa`/`security`). Todo o resto — `init`, `sessions`, as tools MCP —
fala com o Postgres direto usando o JWT local. Rode `nio debug` a qualquer
momento pra ver o que está ok e o que falta.

---

## Arquitetura

Hexagonal. O núcleo não conhece IO; os adapters implementam os contratos.

```
entrypoints:  src/cli.ts (nio)          src/gateway/index.ts (nio-gateway)
              src/mcp-server.ts (nio-cli)   src/mcp-server-lang.ts (nio-lang)
app:          SessionManager · EnvironmentBuilder · DependencyWatcher · DockerManager
core/:        types.ts (entidades + enums)  +  ports por domínio, sem IO:
              repositories.ts · environment.ts · docker.ts · messaging.ts · lang.ts
adapters/:    pg/ (Postgres)  ide/ (vscode)  pkg/ (npm,pip,…)  docker/  sms/  skills/  lang/
profiles/:    catálogo dos 6 perfis (fixos no fonte)
```

- **Runtime:** Node 20.12+ é o alvo. Bun roda o projeto em dev, mas **nada**
  depende de API exclusiva do Bun — só as equivalentes de `node:*`.
- **Build:** `tsc` puro → `dist/`. Sem bundler.
- **Banco:** `pg` + um `Pool` único (`src/adapters/pg/client.ts`). Sem Supabase,
  sem PostgREST, sem `Bun.sql`.
- **Gateway:** `http.createServer` nativo, loopback, atrás do Kong OSS (opcional,
  pra rate-limiting). JWT HS256, `jti` = id da `auth_session`. Trilha de auth em
  stderr estruturado — nunca a senha nem o OTP em texto puro.
- **Contrato "nunca lança"** nos ports de IO (`ToolchainGateway`, `IdeGateway`,
  `DockerGateway`, `SmsSender`): falha vira um resultado `{ status, error? }`.

Detalhes: [`docs/arch/`](docs/arch/) (uma `ARQUITETURA-*.md` por camada) e os
[ADRs](docs/adr/). Histórico cronológico: [`docs/PROGRESSO.md`](docs/PROGRESSO.md).

### Perfis

Fixos no fonte (`src/core/types.ts`) — novos perfis só entram alterando o código:

`fullstack` · `analyst` · `scientist` · `dba` · `qa` · `bi`

---

## Autenticação

```bash
nio register    # cria o usuário (user_cli), senha com hash argon2id
nio login       # autentica via nio-gateway e salva o JWT em ~/.nio/session.json
nio whoami      # mostra quem está logado (--json pra saída estável)
nio logout      # revoga a auth_session no banco e limpa a sessão local
```

### 2º fator (SMS)

Opt-in por conta. Com `auth_2` ativo, o `nio login` pede um código de 6 dígitos
por SMS; se o SMS não chega, vale um dos 10 **códigos de backup** (mostrados uma
vez no `enable-2fa`).

```bash
nio security enable-2fa               # cadastra o celular, confirma via SMS, mostra os backups
nio security status                   # ativo? número (mascarado)? quantos backups restam?
nio security disable-2fa
nio security regenerate-backup-codes
```

O gateway gera/valida o OTP em processo (sem Twilio, sem broker), guarda só o
**HMAC** do código (TTL 5 min, 3 tentativas, uso único) e manda o SMS por um
**adapter HTTP genérico**. Sem `SMS_ENDPOINT_URL` no ambiente, o login com
`auth_2` responde `503 "2FA não configurado"` — o login de 1 fator segue normal.
Detalhes: [spec 0004](docs/specs/auth/0004-login-2fa-sms-otp.md) ·
[ADR 0006](docs/adr/0006-2fa-sms-otp.md) ·
[`docs/arch/ARQUITETURA-GATEWAY.md`](docs/arch/ARQUITETURA-GATEWAY.md).

Pra testar sem SMS real, o repo traz um mock: `bun run dev:sms-echo` sobe um
endpoint local que imprime o código no terminal (aponte `SMS_ENDPOINT_URL` pra ele).

---

## Operador de IA (`nio ai`)

No fim do `nio init` a CLI sobe o **client de IA** da sessão — e o mesmo `nio ai`
retoma a qualquer momento. Ele:

1. **Sobe o Headroom** — proxy de compressão de contexto em container Docker
   (`headroom/docker-compose.yml`), **obrigatório** ([ADR 0007](docs/adr/0007-headroom-proxy-obrigatorio.md)).
   Sem Docker, `nio ai` para com erro acionável (o `nio init` não morre — materializa
   o ambiente e deixa a linha `nio ai` pra retomar). Manual: `nio docker headroom {up,down,status}`.
2. **Aponta o provider pro Headroom** — grava `provider.opencode.options.baseURL`
   no `~/.config/opencode/opencode.json` (junto do `model: opencode/big-pickle`,
   do MCP `nio` e dos MCPs do perfil).
3. **Sobe o `opencode serve` headless e abre a interface NIO** (Ink — chat
   streamado, sidebar verde, paleta `/` com os comandos e capacidades do NIO). O
   motor é o `opencode/big-pickle`; a casca é nossa. Se a sessão tem IDE (VS Code /
   Cursor), o `nio init` grava um `.vscode/tasks.json` (task `NIO`, `runOn: folderOpen`)
   e o `nio ai` sobe num **terminal integrado da IDE** — uma superfície, não duas.
   Sem IDE, roda no terminal atual. Sem TTY / sem `opencode` → cai na TUI do OpenCode.

Ver [`docs/arch/ARQUITETURA-CLIENTE-IA.md`](docs/arch/ARQUITETURA-CLIENTE-IA.md) e
[`docs/arch/ARQUITETURA-CLIENTE-TUI.md`](docs/arch/ARQUITETURA-CLIENTE-TUI.md).

> A interface NIO (Ink) está na **fatia 2a** ([ADR 0008](docs/adr/0008-interface-nio-ink.md)).
> A paridade completa com o OpenCode (diff viewer, file tree, seletor de modelo…) é a 2b.
> Multi-cliente (OpenCode | Codex) e o ladder de failover entre modelos seguem
> parkeados em
> [`docs/arch/ARQUITETURA-CLIENTES-MULTI-FUTURO.md`](docs/arch/ARQUITETURA-CLIENTES-MULTI-FUTURO.md)
> ([ADR 0004](docs/adr/0004-operador-ia-unico.md)).

---

## Comandos do CLI

Operações do CLI, **sem o binário na frente** (declarado no cabeçalho da tabela).
Gerada da fonte por `npm run gen:docs`. Ajuda de qualquer comando: `nio <cmd> --help`.

<!-- COMMANDS:START -->
<!-- gerado por `bun run gen:docs` — não edite à mão. binário `nio`, 42 comandos. -->

| Comando | Descrição |
| --- | --- |
| `ai` | Abre a interface NIO da sessão ativa (Headroom + opencode serve + Ink) |
| `ai status` | Estado do Headroom (proxy obrigatório do client de IA) |
| `clean-legacy` | Remove commands/skills legados (substituídos) de ~/.claude e ~/.codex |
| `completion [shell]` | Imprime o script de autocomplete (bash\|zsh\|fish). |
| `config` | Config compartilhada da equipe (~/.nio/config.env) |
| `config check` | Confere se a config está completa e o Postgres responde |
| `config path` | Imprime o caminho do arquivo de config |
| `config setup` | Wizard: cola os valores do time, testa a conexão e salva |
| `docker` | Camada Docker: MCP Gateway + Portainer, compose, debug e cluster (Swarm) |
| `docker cluster <action> [arg]` | Docker Swarm — stack `nio-cluster` (up\|down\|status\|scale) |
| `docker compose <action> [service]` | Wrapper sobre `docker compose` do projeto (up\|down\|restart\|ps\|logs) |
| `docker create` | Cria e sobe um container (wizard ou flags) |
| `docker debug [container]` | Coleta o contexto de um container e entrega o diagnóstico pro operador de IA |
| `docker headroom` | Proxy de compressão de contexto — obrigatório pro `nio ai` (ADR 0007) |
| `docker headroom down` | Derruba o container do Headroom |
| `docker headroom status` | O Headroom está no ar? |
| `docker headroom up` | Sobe o container do Headroom |
| `docker orquest [instruction]` | Orquestra os serviços do projeto via compose, dirigido pelo operador (linguagem natural) |
| `docker portainer` | Abre o Portainer no navegador |
| `docker toolkit` | Infra NIO: Docker MCP Gateway + Portainer (docker/docker-compose.yml) |
| `docker toolkit down` | Derruba a infra e desabilita o MCP no opencode.json |
| `docker toolkit status` | Estado dos containers + health dos endpoints |
| `docker toolkit up` | Sobe a infra e registra o gateway no opencode.json |
| `docs` | Documentação completa da CLI (terminal ou página com --html) |
| `exec` | Delega a implementação a um agente headless num worktree e aguarda. |
| `exec-status <jobId>` | Estado de um job de execução (`nio exec`), em JSON |
| `init` | Cria nio.json no diretório atual e materializa o ambiente da sessão |
| `login` | Autentica via nio-gateway (túnel HTTP) e salva a sessão localmente (JWT) |
| `logout` | Encerra a sessão local e revoga a auth_session no banco |
| `plan` | Roda o engine pensante sobre o projeto e escreve/refina o plan.md da raiz. |
| `register` | Cria um novo usuário no banco (user_cli) e já entra (login) |
| `security` | 2º fator do login (SMS OTP + códigos de backup) |
| `security disable-2fa` | Desativa o 2º fator |
| `security enable-2fa` | Ativa o 2º fator via SMS |
| `security regenerate-backup-codes` | Invalida os códigos de backup e gera 10 novos |
| `security status` | Mostra o estado do 2º fator |
| `skills` | Skills, commands e agents do nio (lidos do repo aberto via cache) |
| `skills status` | Lista os docs do repo de skills (cache local ~/.nio/skills) |
| `start` | Conduz a esteira: config → gateway → login → sessão → OpenCode |
| `sync` | Instala/atualiza skills, commands e agents nos clientes configurados, a partir do bundle (idempotente); checa atualização do pacote |
| `validate-plan` | Lê o plan.md da raiz e roda o engine pensante para julgar se o plano precisa de uma spec antes de implementar. |
| `whoami` | Mostra o usuário autenticado |
<!-- COMMANDS:END -->

### Diagnóstico da própria CLI

```bash
nio debug        # bateria de checagens: nio.json, login, Postgres, sessão ativa,
                 # OpenCode no PATH, cache de skills — ✓ / ⚠ / ✗ com dica em cada
nio docs         # documentação completa no terminal
nio docs --html  # a mesma coisa como página (arte); --open abre no navegador
```

### Autocomplete (tab)

O `nio init` **oferece** ativar; o `nio sync` **valida** e prompta se faltar. À mão:

```bash
eval "$(nio completion zsh)"     # ~/.zshrc
eval "$(nio completion bash)"    # ~/.bashrc
nio completion fish | source     # ~/.config/fish/config.fish
```

---

## Docker (`nio docker`)

Camada de gerência de container — metade wrapper determinístico sobre `docker`,
metade dirigida pelo operador de IA em linguagem natural (via o **Docker MCP
Gateway**). Roda em qualquer Docker Engine (não exige Docker Desktop). Ver
[`docs/arch/ARQUITETURA-DOCKER.md`](docs/arch/ARQUITETURA-DOCKER.md) ·
[ADR 0005](docs/adr/0005-camada-docker.md).

```bash
nio docker toolkit up            # sobe o MCP Gateway (127.0.0.1:8811/mcp) + Portainer (9443)
                                 # e registra o gateway no opencode.json
nio docker compose up -f app/docker-compose.yml   # wrapper sobre `docker compose` do projeto
nio docker create --image redis:7 --port 6379:6379
nio docker debug <container>     # coleta ps/logs/inspect → operador analisa e propõe o fix
nio docker orquest "sobe api + worker + redis"    # operador gera o compose e sobe (--dry-run mostra)
nio docker cluster up "api + worker + redis + postgres"   # Docker Swarm (stack `nio-cluster`)
nio docker cluster status | scale api=3
nio docker portainer             # abre a UI
```

`debug`/`orquest`/`cluster` exigem `nio login` + sessão ativa + `opencode` no
PATH. O estado do cluster fica em `sessions.config` (Postgres), validado contra
`docker stack services`.

---

## Tools MCP

O servidor `nio-cli` expõe as tools de ambiente v2 (todas passam pelo
`SessionManager` e exigem `nio login`):

<!-- TOOLS:START -->
<!-- gerado por `bun run gen:docs` — não edite à mão. 10 tools. -->

### Tools que espelham o CLI — prefixo `nio_`

| Operação | O que faz |
| --- | --- |
| `delegate_exec` | Delega a IMPLEMENTAÇÃO a um agente de execução novo (codex ou claude local, na assinatura — sem API) num worktree já criado pelo /implement. |
| `env_detect_deps` | Roda UM ciclo do watcher de dependências sobre a pasta da sessão: escaneia os manifests (package.json, requirements.txt, Cargo.toml), detecta o que está declarado mas não instalado e registra um evento por dependência nova (idempotente). |
| `env_materialize` | Re-materializa o ambiente de uma sessão existente a partir do seu perfil: garante os toolchains de novo, re-resolve os MCPs e reescreve o `config` em `sessions.config`. |
| `exec_status` | Estado de uma execução delegada (`nio_delegate_exec`): running \| done \| failed, com o resumo do agente, os arquivos alterados e os checks determinísticos (tamanho, lint, build, testes). |
| `plan` | Roda o engine PENSANTE (claude ou codex local, na assinatura — sem API) sobre a raiz do projeto e escreve/refina o `plan.md` de rascunho pré-SDD. |
| `profile_get` | Consulta o catálogo de perfis de ambiente (hardcoded na CLI). |
| `session_activate` | Ativa uma sessão de ambiente do usuário por id (o prefixo do UUID basta). |
| `session_create` | Cria uma sessão de ambiente pro usuário autenticado e materializa o perfil escolhido: garante os toolchains, resolve os MCPs e persiste o `config` em `sessions.config`. |
| `session_list` | Lista as sessões de ambiente do usuário autenticado (mais recentes primeiro), com id, nome, perfil, status e o `config` materializado. |
| `validate_plan` | Lê o `plan.md` da raiz do projeto e roda o engine PENSANTE (claude ou codex local, na assinatura — sem API) para julgar se o plano é complexo o bastante para virar uma spec SDD antes de implementar. |
<!-- TOOLS:END -->

### Recipes de ambiente (repo NIO-SKILLS)

Além dos 6 perfis fixos, o repo `NIO-SKILLS-` pode carregar **recipes** em
`recipes/<slug>.md` — presets nomeados (`profile` + linguagens + frameworks +
MCPs + envVars/aliases) que **estendem** um perfil, editáveis sem release da CLI.
O `nio init` oferece a recipe depois do perfil; `nio_session_create` aceita
`{ recipe: "<slug>" }`. Merge determinístico (recipe vence em envVars/aliases;
união em linguagens/frameworks/MCPs).

---

## Skills, commands e dependências

Além das tools, o nio entrega skills/commands/agents/hooks pros clientes. O conteúdo
vive num **repo aberto** — [`hugoreiis12-png/NIO-SKILLS-`](https://github.com/hugoreiis12-png/NIO-SKILLS-) —
e **não** é um pacote npm. O CLI baixa o repo (zipball do GitHub, sem precisar de `git`)
pra um cache local em **`~/.nio/skills`** e lê de lá. `nio sync` **atualiza o cache**
(pull da branch) toda vez, então as skills evoluem sem republicar o CLI; e **auto-detecta**
quais clientes têm o nio configurado, provisionando pra cada um conforme a seleção de
perfil/área do `nio.json`.

Overrides por ambiente:

| Variável              | Efeito                                                              |
| --------------------- | ------------------------------------------------------------------ |
| `NIO_SKILLS_DIR`   | Aponta pra um checkout local do repo (dev) — vence tudo            |
| `NIO_SKILLS_REPO`  | Outro `owner/repo` (default `hugoreiis12-png/NIO-SKILLS-`)           |
| `NIO_SKILLS_REF`   | Outra branch/tag (default `main`)                                  |

Cada cliente recebe no formato que entende:

| Cliente         | Onde                          | Formato                                                                 |
| --------------- | ----------------------------- | ----------------------------------------------------------------------- |
| Claude Code     | `~/.claude/{commands,skills,agents}` | arquivos nativos — slash-commands e skills                       |
| Codex CLI       | `~/.codex/`                   | **dual-write**: cada command/skill vira uma **skill** (`skills/<id>/SKILL.md`, auto-selecionada) **e** um **custom prompt** (`prompts/<id>.md`, no menu `/prompts:<id>`) |
| Cowork/Desktop  | —                             | via **MCP prompts** + resources, servidos ao vivo (ignora `~/.claude`)  |

> Configurar o Codex grava `NIO_CLIENT=codex` no `config.toml`, o que faz o servidor
> provisionar pra `~/.codex` e filtrar os docs pelo surface `codex`. Reinicie o cliente
> depois do sync pra carregar skills/prompts novos.

> **Como aparecem no Cowork/Claude Desktop.** Lá as skills chegam como **prompts MCP**,
> que o app expõe como **slash-commands** no menu de conectores/"+" (ex.: digite `/` e
> procure os itens do nio) — são **invocados manualmente**, não carregados sozinhos
> como Agent Skills que o modelo detecta e usa por conta própria. Se não aparecerem:
> feche o app de vez (Cmd+Q) e reabra, e confirme que o conector nio está conectado.

### Visibilidade por cliente

Um doc pode ser restrito a clientes específicos via frontmatter:

```yaml
clients: claude-code, cowork   # vazio/ausente = todos os clientes
```

Valores: `claude-code`, `codex`, `cowork`. O MCP filtra por esse campo, então um skill
marcado `cowork` não é provisionado pro `~/.claude`, e um `claude-code` não aparece como
prompt no Cowork.

### Dependências externas

Commands/skills podem depender de libs externas, declaradas como arquivos em
`dependencies/` no repo de skills (a presença do arquivo é a declaração). No fim do
`init`/`sync`, a CLI lista cada uma e:

- **instalador estruturado** (`npm:`, `skills:` = `npx skills add`, `git:`) → oferece
  rodar com `[y/N]` (comando montado a partir do campo validado, **sem shell**);
- **`manual:`** (plugin de marketplace, passos no cliente, UI) → imprime os passos por
  cliente, com os comandos destacados.

A string `install:` (se houver) é **só exibição** — nunca é executada. A CLI **detecta
o que já está instalado** e mostra um selo `✓ instalada` (via `npm ls -g`, dir de
destino, ou o `detect:` do frontmatter).

---

## Claude Desktop / Cowork

Selecione **Cowork** na lista de clientes do `nio init`. Com o app instalado e você
logado (`nio login`), a CLI **ativa o conector direto** — escreve o `nio` no
`claude_desktop_config.json` com caminhos absolutos (`node` + `dist/mcp-server.js`)
e `NIO_CLIENT=cowork`. Reinicie o Claude Desktop pra carregar. O `nio sync` reafirma
esse config.

**Fallback `.mcpb`:** se a escrita direta falhar, a CLI gera
`~/Downloads/nio-cli-<versão>.mcpb` e mostra os passos — Configurações → Extensões →
Configurações avançadas → "Extension Developer" → "Install Extension…".

---

## Atualizando

```bash
npm i -g @nio-cli/cli@latest
```

O `nio sync` **checa a versão publicada** no início e **oferece atualizar** ali mesmo
(com sua confirmação). `nio sync --yes` aceita sem prompt. A CLI também avisa em
background em qualquer comando (`update-notifier`).

---

## Troubleshooting

| Sintoma | Causa provável / o que fazer |
|---|---|
| `nio: command not found` | `npm i -g @nio-cli/cli` e confira `npm bin -g` no PATH |
| `Configuração necessária` / `NIO_DATABASE_URL não definida` | rode `nio config setup` (ou deixe o `nio init` abrir o wizard) |
| `Não consegui falar com o nio-gateway` | o `nio-gateway` não está no ar — rode `nio-gateway &` |
| `Não autenticado` | `nio register` (1ª vez) e depois `nio login` |
| Erro de conexão com o banco | `ECONNREFUSED` = Postgres fora do ar / host errado; `password authentication failed` = credencial; erro de SSL = `NIO_DATABASE_SSL=true` |
| `2FA não configurado no servidor` (503) | faltam as `SMS_*` no ambiente do `nio-gateway` |
| Tools não aparecem no Claude Code | reinicie o cliente depois do `nio init`; cheque com `/mcp` |
| Skills não aparecem no Cowork | chegam como **prompts MCP** (slash-commands), não skills autônomas. Cmd+Q e reabra; confirme o conector |
| `Conteúdo de skills não encontrado` | cache `~/.nio/skills` vazio — rode `nio sync` com rede, ou `NIO_SKILLS_DIR` pra um checkout local |
| Sobraram comandos antigos | `nio clean-legacy` (`--dry-run` pra revisar antes) |

Sempre: `nio debug` mostra o estado de tudo com uma dica por item. E
`NIO_DEBUG=1 nio <cmd>` liga log verboso (`[nio:debug]` em stderr): `.env`
carregados, config resolvida, requests pro gateway, e stack trace completo nos erros.

O logo Matrix anima (chuva caindo) toda vez que aparece em terminal interativo.
`NIO_NO_ANIM=1` deixa ele sempre estático; fora de TTY (pipe/CI) já é estático.

---

## Convenções

- **Idioma:** UI/CLI em pt-BR. Código (variáveis, funções, tipos) em inglês.
- **Backups:** toda escrita em config existente gera `.bak.<timestamp>` ao lado.
- **stdout reservado pro JSON-RPC** no MCP server — logs vão pra stderr.
- **Regra do hexágono:** `core/ports.ts` / `core/repositories.ts` não importam
  driver de banco; os adapters (`adapters/*`) implementam os contratos.
- **Migrations:** fonte da verdade em `db/schema.sql`; deltas incrementais em
  `db/migrations/NNNN_*.sql`, aplicados à mão (`psql -f`).

---

## Versão

**0.2.0** — v1 da CLI fechada: auth (senha + 2º fator SMS), backend de sessões,
wizard de ambiente, tools MCP de ambiente, camada Docker e o gateway com Kong.
Nasceu de um cliente NOS/Supabase (v1), já removido. Histórico cronológico:
[`docs/PROGRESSO.md`](docs/PROGRESSO.md).
