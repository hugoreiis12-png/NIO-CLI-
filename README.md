
MCP server + CLI pra controlar o **NIO** (Nucleo Operacional de Inteligência) a partir do Claude Code, Codex CLI e GitHub Copilot.
s
## O que faz

Permite ao assistente de IA:

- Ler contexto do projeto (membros, sprint ativa, repositórios vinculados)
- Listar, criar, atualizar, mover entre colunas e comentar tarefas
- Bater ponto e cronometrar tempo em tarefas específicas

## Instalação (mac / linux / windows)

Precisa apenas de **Node.js 20+**. Instala como pacote global:

```bash
 npm i -g @nio-cli/cli@0.1.0
```

Pronto. Os comandos `nio` (CLI) e `nio-cli` (servidor MCP) ficam disponíveis no PATH em qualquer SO.

## Configurar em qualquer repo

Na raiz do repositório:

```bash
nio init
```

Esse único comando faz tudo:

1. Pede o seu **PAT** se você ainda não está autenticado (fluxo de geração em migração — ver `docs/specs/auth/0002-cli-native-login.md`).
2. Lista os projetos  e você escolhe um (ou cola o UUID).
3. (Opcional) Escolhe o repositório vinculado.
4. Escreve `nio.json` na raiz **e o adiciona ao `.gitignore`** (binding local, não versionado).
5. Mostra o contexto carregado pra você validar.
6. Pergunta quais clientes MCP configurar — global ou por-repo.

Reinicie o cliente de IA depois pra carregar as tools.

## Comandos do CLI

Operações do CLI, **sem o binário na frente** (declarado no cabeçalho da tabela). Tabela
gerada da fonte por `bun run gen:docs`.

<!-- COMMANDS:START -->
<!-- gerado por `bun run gen:docs` — não edite à mão. binário `nio`, 13 comandos. -->

| Comando | Descrição |
| --- | --- |
| `clean-legacy` | Remove commands/skills legados (substituídos) de ~/.claude e ~/.codex |
| `completion [shell]` | Imprime o script de autocomplete (bash\|zsh\|fish). |
| `exec` | Delega a implementação a um agente headless num worktree e aguarda. |
| `exec-status <jobId>` | Estado de um job de execução (`nio exec`), em JSON |
| `init` | Cria nio.json no diretório atual vinculando a um projeto do NOS |
| `login [pat]` | Salva o token de acesso pessoal (PAT) localmente |
| `logout` | Remove credenciais locais |
| `plan` | Roda o engine pensante sobre o projeto e escreve/refina o plan.md da raiz. |
| `skills` | Skills, commands e agents do nio (lidos do repo aberto via cache) |
| `skills status` | Lista os docs do repo de skills (cache local ~/.nio/skills) |
| `sync` | Instala/atualiza skills, commands e agents nos clientes configurados, a partir do bundle (idempotente); checa atualização do pacote |
| `validate-plan` | Lê o plan.md da raiz e roda o engine pensante para julgar se o plano precisa de uma spec antes de implementar. |
| `whoami` | Mostra o usuário autenticado |
<!-- COMMANDS:END -->

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

## Tools disponíveis

Operações do MCP, com o nome **sem o prefixo** (declarado por grupo — o prefixo vem de
`src/brand.ts`). Tabela gerada da fonte por `bun run gen:docs`.

<!-- TOOLS:START -->
<!-- gerado por `bun run gen:docs` — não edite à mão. 20 tools. -->

### Tools de produto — prefixo `nos_`

| Operação | O que faz |
| --- | --- |
| `comment_task` | Adiciona um comentário em uma tarefa. |
| `create_task` | Cria uma nova tarefa no projeto atual. |
| `end_allocation` | [ENCERRA O DIA] Bate ponto de SAÍDA do usuário e fecha qualquer task_allocation aberta. |
| `end_task_allocation` | [PARA TIMER DE TASK] Para a task_allocation ativa. |
| `get_active_allocation` | Retorna o estado atual de cronometragem do usuário: alocação ativa, task atual sendo cronometrada, e segmentos por task na alocação atual. |
| `get_context` | Retorna o contexto completo do projeto NOS ativo: dados do projeto, repositórios, sprint ativa, membros e usuário autenticado. |
| `get_task` | Retorna detalhes completos de uma tarefa: descrição, assignees, checklist, comentários, histórico recente, repositórios vinculados e labels. |
| `list_my_allocations` | Lista alocações passadas do usuário (encerradas), ordenadas por data decrescente. |
| `list_projects` | Lista os projetos do NOS aos quais você tem acesso. |
| `list_tasks` | Lista tarefas do projeto atual, filtradas pelos parâmetros opcionais. |
| `move_task` | Atalho pra mudar o status de uma tarefa (move entre colunas do Kanban). |
| `record_delivery` | Registra uma ENTREGA do loop de build (um ticket concluído / PR aberto) na analítica de entrega do NOS. |
| `set_project` | Define o projeto ativo da sessão (em memória, dura enquanto o servidor estiver rodando). |
| `start_allocation` | Inicia uma alocação (bate o ponto) para o usuário atual. |
| `start_task_allocation` | Começa a cronometrar tempo numa task específica. |
| `update_task` | Atualiza campos de uma tarefa existente. |

### Tools que espelham o CLI — prefixo `nio_`

| Operação | O que faz |
| --- | --- |
| `delegate_exec` | Delega a IMPLEMENTAÇÃO a um agente de execução novo (codex ou claude local, na assinatura — sem API) num worktree já criado pelo /implement. |
| `exec_status` | Estado de uma execução delegada (`nio_delegate_exec`): running \| done \| failed, com o resumo do agente, os arquivos alterados e os checks determinísticos (tamanho, lint, build, testes). |
| `plan` | Roda o engine PENSANTE (claude ou codex local, na assinatura — sem API) sobre a raiz do projeto e escreve/refina o `plan.md` de rascunho pré-SDD. |
| `validate_plan` | Lê o `plan.md` da raiz do projeto e roda o engine PENSANTE (claude ou codex local, na assinatura — sem API) para julgar se o plano é complexo o bastante para virar uma spec SDD antes de implementar. |
<!-- TOOLS:END -->

> **Escopo do projeto.** As tools de tarefa/alocação resolvem o projeto nesta ordem:
> argumento `project_id` da chamada → projeto ativo da sessão (`set_project`) → default
> opcional do binding de repo (`nio.json`/`NIO_PROJECT_ID`).
>
> O projeto ativo é **por sessão**: vive só em memória, no processo do servidor MCP, e
> não é gravado em disco — ao reiniciar volta ao default. No Cowork, onde não há binding
> de repo, é sempre assim que se escolhe o projeto: `list_projects` → `set_project`.
> (Como um processo do Claude Desktop pode ser compartilhado entre conversas, passe
> `project_id` direto na chamada quando quiser garantir o escopo de uma conversa.)

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
| `NOCLAF_SKILLS_REF`   | Outra branch/tag (default `main`)                                  |

Cada cliente recebe no formato que entende:

| Cliente         | Onde                          | Formato                                                                 |
| --------------- | ----------------------------- | ----------------------------------------------------------------------- |
| Claude Code     | `~/.claude/{commands,skills,agents}` | arquivos nativos — slash-commands e skills                       |
| Codex CLI       | `~/.codex/`                   | **dual-write**: cada command/skill vira uma **skill** (`skills/<id>/SKILL.md`, auto-selecionada) **e** um **custom prompt** (`prompts/<id>.md`, no menu `/prompts:<id>`) |
| Cowork/Desktop  | —                             | via **MCP prompts** + resources, servidos ao vivo (ignora `~/.claude`)  |

> Configurar o Codex grava `NOCLAF_CLIENT=codex` no `config.toml`, o que faz o servidor
> provisionar pra `~/.codex` e filtrar os docs pelo surface `codex`. Reinicie o cliente
> depois do sync pra carregar skills/prompts novos.

> **Como aparecem no Cowork/Claude Desktop.** Lá as skills chegam como **prompts MCP**,
> que o app expõe como **slash-commands** no menu de conectores/"+" (ex.: digite `/` e
> procure os itens do nio) — são **invocados manualmente**, não carregados sozinhos
> como Agent Skills que o modelo detecta e usa por conta própria. Se não aparecerem:
> feche o app de vez (Cmd+Q) e reabra, e confirme que o conector nio está conectado
> (deve listar as tools `nos_*`). O processo do Cowork lê o mesmo cache `~/.nio/skills`
> — se o `nio sync` populou, o conteúdo está lá.

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
  cliente, com os comandos destacados. Ex.: o Ponytail é instalado por `/plugin` no Claude
  Code e `codex plugin …` + `/hooks` no Codex — a CLI não automatiza, só orienta.

A string `install:` (se houver) é **só exibição** — nunca é executada.

A CLI **detecta o que já está instalado** e mostra um selo verde `✓ instalada` (sem
repetir descrição/passos): `npm` via `npm ls -g`, `git` pelo dir de destino, `skills`
por marcador/probe. Pra deps `manual:` (plugins), declare `detect:` no frontmatter com
um ou mais globs — suporta `~`, `*` e `**`, e segue symlinks (ok com dotfiles). Ex.: o
Ponytail usa `detect: ~/.claude/plugins/**/ponytail`.

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
`dist/mcp-server.js`) e `NOCLAF_CLIENT=cowork`. Reinicie o Claude Desktop pra carregar.
O `nio sync` reafirma esse config (atualiza os paths se o node/pacote mudou de lugar).

Não há projeto pra configurar: o Cowork não tem `nio.json` (sem working dir/repo),
então o projeto é **escolhido por sessão** — peça pro assistente rodar `nos_list_projects`
e depois `nos_set_project` com o id desejado.

### Fallback: extensão `.mcpb`

Se o app estiver instalado mas a escrita direta falhar, ou você não tiver login salvo, a
CLI cai pro **fallback manual**: gera uma extensão `~/Downloads/nio-cli-<versão>.mcpb`
e mostra os passos:

**Configurações → Extensões → Configurações avançadas → seção "Extension Developer" →
"Install Extension…"** → selecione o `.mcpb` → preencha **só o PAT**.

Pela extensão a config não vem do `nio login`/`nio.json`, e sim do `user_config`,
injetado como variável de ambiente:

| Variável     | Origem (`user_config`) | Sensível |
| ------------ | ---------------------- | -------- |
| `NOCLAF_PAT` | PAT (`noc_…`)          | ✅ sim   |

> **Override de default (avançado, opcional).** Fora do Cowork, em CLIs de código, você
> ainda pode definir `NIO_PROJECT_ID`/`NOCLAF_REPOSITORY_ID` no env do cliente MCP pra
> fixar um projeto default — equivalente ao `nio.json`. O projeto da sessão
> (`nos_set_project`) e o `project_id` por chamada sempre têm precedência sobre esse default.

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
- **`Não autenticado`** — rode `nio init` (que já faz login inline) ou `nio login`. No Cowork, confira se o **PAT** foi preenchido na extensão.
- **`Nenhum projeto selecionado`** — escolha o projeto da sessão: `nos_list_projects` → `nos_set_project`. (Em CLI de código você também pode rodar `nio init` pra criar um `nio.json` default no repo.)
- **Skills não aparecem no Cowork** — elas chegam como **prompts MCP** (slash-commands no menu de conectores/"+"), não como skills autônomas. Feche o Claude Desktop de vez (Cmd+Q) e reabra; confirme o conector conectado (tools `nos_*` listadas).
- **`Conteúdo de skills não encontrado`** — o cache `~/.nio/skills` está vazio (fetch falhou / offline). Rode `nio sync` com rede, ou defina `NIO_SKILLS_DIR` pra um checkout local. Confirme também que o repo de skills está público.
- **`ENOENT … mkdir` ao provisionar (dotfiles)** — um symlink em `~/.claude` aponta pra um alvo inexistente. As versões atuais materializam o alvo automaticamente; se persistir, cheque o link.
- **Sobraram comandos antigos** (`new-spec`, `apply-bug`, `init-sdd` como command…) — rode `nio clean-legacy` (use `--dry-run` pra revisar antes) pra removê-los de `~/.claude` e `~/.codex`.

## Convenções

- **Idioma**: UI/CLI em pt-BR. Código (variáveis, funções, tipos) em inglês.
- **Backups**: qualquer escrita em arquivo de config existente gera `.bak.<timestamp>` ao lado.
- **stdout reservado pro JSON-RPC** no MCP server — logs vão pra stderr.

## Versão

v0.1.x — feature complete pra v1. Próximos passos: testes automatizados,
suporte a múltiplos perfis de usuário.
