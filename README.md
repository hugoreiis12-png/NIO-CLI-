NIO-CLI — orquestrador de ambientes de desenvolvimento. Você escolhe um
perfil, responde um wizard, e a CLI (com auxílio de IA via MCP) materializa
o ambiente: toolchains, linguagens, frameworks, dotfiles, aliases e IDE. A
entidade central é a **Sessão** — um ambiente isolado, com UUID, persistido
no Postgres.


## Perfis disponíveis

Fixos no código-fonte (`src/core/session.ts`) — novos perfis só entram
alterando o fonte:

`fullstack` · `analyst` · `scientist` · `dba` · `qa` · `bi`

## Estado atual (23 ago 2026)

| Peça | Status |
|---|---|
| Schema Postgres v2 (5 tabelas: `user_cli`, `sessions`, `log_session`, `session_activity`, `dependency_events`) | ✅ Pronto — `db/schema.sql` |
| `nio register` / `nio login` / `nio logout` / `nio whoami` | ✅ Funcionando ponta a ponta — senha com hash argon2id, sessão local em `~/.nio/session.json` |
| Autenticação do MCP server | ✅ v2 — valida a sessão local contra `user_cli.token_session`, sem Supabase |
| `SessionRepository` (CRUD de sessões, invariante de 1 sessão ativa por usuário) | ✅ Implementado (`src/adapters/pg/session-repository.ts`) — **ainda sem nenhum comando de CLI ou tool MCP que o exponha** |
| Wizard de perfil / `EnvironmentBuilder` / `DependencyWatcher` | ❌ Não existem ainda |
| `nio init` | 🟡 Ainda vincula a um projeto do NOS legado (Supabase) — candidato a redesenho pro wizard de sessão/perfil, ver `docs/v2/TASK-remocao-v1.md` |
| 2º fator de login (SMS) + Gateway (Edge Filter/Kong/Gateway core) | 📐 Arquitetura desenhada e documentada, **zero código ainda** — ver `docs/v2/ARQUITETURA-GATEWAY.md` |
| Tools MCP de tarefas/sprints/ponto (v1) | ✅ Removidas do servidor — só sobram as 4 tools genéricas de execução (tabela abaixo) |
| Resquícios de Supabase no código (`src/adapters/supabase/*`, `src/auth.ts`, `package.json`) | 🟡 Ainda presentes, não usados pelos caminhos ativos — remoção final pendente |

Histórico completo e cronológico das decisões: `docs/v2/PROGRESSO.md`.
Documento de transição: `NIO-CLI-Transicao-v1-v2.md`.

## Instalação (mac / linux / windows)

Precisa apenas de **Node.js 20+**. Instala como pacote global:

```bash
npm i -g @nio-cli/cli@0.1.0
```

Pronto. Os comandos `nio` (CLI) e `nio-cli` (servidor MCP) ficam disponíveis no PATH em qualquer SO.

## Banco de dados

PostgreSQL dedicado (database `nio_cli`), via driver `pg` 

```bash
# .env na raiz (git-ignorado)
NIO_DATABASE_URL=postgres://usuario:senha@host:5432/nio_cli
# NIO_DATABASE_SSL=true   # só se o banco exigir TLS
```

Schema versionado em `db/schema.sql`; alterações incrementais em `db/migrations/`.
Healthcheck: `bun run db:ping`.

## Autenticação

```bash
nio register    # cria seu usuário (user_cli), senha com hash argon2id
nio login        # autentica e salva a sessão em ~/.nio/session.json
nio whoami        # mostra quem está logado (--json pra saída estável)
nio logout        # encerra a sessão local e limpa o token no banco
```

Um segundo fator (código por SMS, via Twilio Verify) está desenhado mas
ainda não implementado — o fluxo completo, as decisões de arquitetura
(Kong Gateway OSS pra JWT/permissionamento, Keycloak descartado, RFC
9700/NIST/ANPD como guia de conformidade) estão em
`docs/v2/ARQUITETURA-GATEWAY.md`.

## Comandos do CLI

Operações do CLI, **sem o binário na frente** (declarado no cabeçalho da tabela). Tabela
gerada da fonte por `bun run gen:docs`.

<!-- COMMANDS:START -->
<!-- gerado por `bun run gen:docs` — não edite à mão. binário `nio`, 14 comandos. -->

| Comando | Descrição |
| --- | --- |
| `clean-legacy` | Remove commands/skills legados (substituídos) de ~/.claude e ~/.codex |
| `completion [shell]` | Imprime o script de autocomplete (bash\|zsh\|fish). |
| `exec` | Delega a implementação a um agente headless num worktree e aguarda. |
| `exec-status <jobId>` | Estado de um job de execução (`nio exec`), em JSON |
| `init` | Cria nio.json no diretório atual vinculando a um projeto do NIO |
| `login` | Autentica contra o banco (user_cli) e salva a sessão localmente |
| `logout` | Encerra a sessão local e limpa o token no banco |
| `plan` | Roda o engine pensante sobre o projeto e escreve/refina o plan.md da raiz. |
| `register` | Cria um novo usuário no banco (user_cli) |
| `skills` | Skills, commands e agents do nio (lidos do repo aberto via cache) |
| `skills status` | Lista os docs do repo de skills (cache local ~/.nio/skills) |
| `sync` | Instala/atualiza skills, commands e agents nos clientes configurados, a partir do bundle (idempotente); checa atualização do pacote |
| `validate-plan` | Lê o plan.md da raiz e roda o engine pensante para julgar se o plano precisa de uma spec antes de implementar. |
| `whoami` | Mostra o usuário autenticado |
<!-- COMMANDS:END -->

> `init` ainda descreve o vínculo com um projeto do NOS legado — é o item
> pendente da tabela de Estado atual, não o desenho final do comando.

### Autocomplete (tab)

O `nio init` **oferece** ativar, e o `nio sync` **valida** e prompta se faltar. Pra
ativar à mão, adicione ao rc do seu shell:

```bash
# zsh  (~/.zshrc)
eval "$(nio completion zsh)"
# bash (~/.bashrc)
eval "$(nio completion bash)"
# fish (~/.config/fish/config.fish)
nio completion fish | source
```

Recarregue o shell e `nio <tab>` passa a sugerir comandos, subcomandos e flags.

## Tools MCP disponíveis

Hoje o servidor MCP expõe só as tools genéricas de execução — as tools de
domínio de tarefas/sprints/ponto (v1) já foram removidas. Tools de ambiente
v2 (`nio_session_*`, `nio_env_*`, `nio_profile_*`) ainda não existem — o
`SessionRepository` que as alimentaria já está pronto no backend, falta
expô-lo.

<!-- TOOLS:START -->
<!-- gerado por `bun run gen:docs` — não edite à mão. 4 tools. -->

### Tools que espelham o CLI — prefixo `nio_`

| Operação | O que faz |
| --- | --- |
| `delegate_exec` | Delega a IMPLEMENTAÇÃO a um agente de execução novo (codex ou claude local, na assinatura — sem API) num worktree já criado pelo /implement. |
| `exec_status` | Estado de uma execução delegada (`nio_delegate_exec`): running \| done \| failed, com o resumo do agente, os arquivos alterados e os checks determinísticos (tamanho, lint, build, testes). |
| `plan` | Roda o engine PENSANTE (claude ou codex local, na assinatura — sem API) sobre a raiz do projeto e escreve/refina o `plan.md` de rascunho pré-SDD. |
| `validate_plan` | Lê o `plan.md` da raiz do projeto e roda o engine PENSANTE (claude ou codex local, na assinatura — sem API) para julgar se o plano é complexo o bastante para virar uma spec SDD antes de implementar. |
<!-- TOOLS:END -->

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
> O processo do Cowork lê o mesmo cache `~/.nio/skills` — se o `nio sync` populou, o
> conteúdo está lá.

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

A string `install:` (se houver) é **só exibição** — nunca é executada.

A CLI **detecta o que já está instalado** e mostra um selo verde `✓ instalada` (sem
repetir descrição/passos): `npm` via `npm ls -g`, `git` pelo dir de destino, `skills`
por marcador/probe. Pra deps `manual:` (plugins), declare `detect:` no frontmatter com
um ou mais globs — suporta `~`, `*` e `**`, e segue symlinks (ok com dotfiles).

### Checagem de cliente

Ao escolher um cliente no `init`, a CLI verifica se ele está de fato instalado na
máquina. Se não estiver:

- **CLIs** (Claude Code, Codex) → mostra e oferece rodar o instalador:
  `npm i -g @anthropic-ai/claude-code` · `npm i -g @openai/codex`;
- **apps** (Claude Desktop/Cowork, VS Code) → mostra o link de download
  (ex.: https://claude.ai/download) — reabra o app depois de instalar.

## Claude Desktop / Cowork

Selecione **Cowork** na lista de clientes do `nio init` (ou rode de novo). Com o app
instalado e você já logado (`nio login`), a CLI **ativa o conector direto** — escreve
o `nio` no `claude_desktop_config.json` usando caminhos absolutos (`node` +
`dist/mcp-server.js`) e `NIO_CLIENT=cowork`. Reinicie o Claude Desktop pra carregar.
O `nio sync` reafirma esse config (atualiza os paths se o node/pacote mudou de lugar).

### Fallback: extensão `.mcpb`

Se o app estiver instalado mas a escrita direta falhar, ou você não tiver login salvo, a
CLI cai pro **fallback manual**: gera uma extensão `~/Downloads/nio-cli-<versão>.mcpb`
e mostra os passos:

**Configurações → Extensões → Configurações avançadas → seção "Extension Developer" →
"Install Extension…"** → selecione o `.mcpb`.

## Atualizando

```bash
npm i -g @nio-cli/cli@latest
```

O `nio sync` **checa a versão publicada** no início e, se houver uma mais nova, mostra
um aviso e **oferece atualizar ali mesmo** (roda `npm i -g @nio-cli/cli@latest` com sua
confirmação; depois é só rodar o sync de novo). Use `nio sync --yes` pra aceitar sem
prompt. A CLI também avisa em background em qualquer comando (via `update-notifier`).

## Troubleshooting

- **`nio-cli: command not found`** — confirme o install global com `npm i -g @nio-cli/cli` e que `npm bin -g` está no PATH.
- **Tools não aparecem no Claude Code** — reinicie o Claude Code depois do `nio init`. Confira com `/mcp` dentro dele.
- **`Não autenticado`** — rode `nio register` (primeira vez) e depois `nio login`.
- **Skills não aparecem no Cowork** — elas chegam como **prompts MCP** (slash-commands no menu de conectores/"+"), não como skills autônomas. Feche o Claude Desktop de vez (Cmd+Q) e reabra; confirme o conector conectado.
- **`Conteúdo de skills não encontrado`** — o cache `~/.nio/skills` está vazio (fetch falhou / offline). Rode `nio sync` com rede, ou defina `NIO_SKILLS_DIR` pra um checkout local. Confirme também que o repo de skills está público.
- **`ENOENT … mkdir` ao provisionar (dotfiles)** — um symlink em `~/.claude` aponta pra um alvo inexistente. As versões atuais materializam o alvo automaticamente; se persistir, cheque o link.
- **Sobraram comandos antigos** (`new-spec`, `apply-bug`, `init-sdd` como command…) — rode `nio clean-legacy` (use `--dry-run` pra revisar antes) pra removê-los de `~/.claude` e `~/.codex`.
- **Erro de conexão com o banco** (`db:ping`, `login`/`register`) — confira `NIO_DATABASE_URL` no `.env` da raiz; `ECONNREFUSED` = Postgres fora do ar ou host/porta errados, `password authentication failed` = credencial errada, erro de SSL = adicione `NIO_DATABASE_SSL=true`.

## Convenções

- **Idioma**: UI/CLI em pt-BR. Código (variáveis, funções, tipos) em inglês.
- **Backups**: qualquer escrita em arquivo de config existente gera `.bak.<timestamp>` ao lado.
- **stdout reservado pro JSON-RPC** no MCP server — logs vão pra stderr.
- **Regra do hexágono**: `core/ports.ts`/`core/repositories.ts` não importam driver de banco algum; os adapters (`adapters/pg/*`) implementam os contratos.

## Versão

v0.1.x — **v2 em construção sobre uma base v1 em remoção ativa**. Auth
(senha) e o backend de sessões estão prontos; wizard de perfil, tools de
ambiente MCP e o Gateway com 2º fator ainda não. Acompanhe o progresso em
`docs/v2/PROGRESSO.md`.