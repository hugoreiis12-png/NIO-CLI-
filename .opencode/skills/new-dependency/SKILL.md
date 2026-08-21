---
name: new-dependency
description: Cria uma nova dependência externa do noclaf (doc `dependency` em `dependencies/<slug>.md` no pacote `@noclaf/skills`) a partir do link do repo e da forma de instalação. Use quando o usuário disser "adicionar uma dependência", "novo lib externo", "criar dependency", "esse command precisa da lib X", ou quando um command/skill passar a depender de uma ferramenta externa (npm, npx skills, git, plugin de marketplace).
---

# Nova dependência

Scaffolda um doc `dependency` no pacote `@noclaf/skills` — o arquivo que declara uma
ferramenta externa que um command/skill precisa em runtime (ex.: `ponytail`, `improve`).
O objetivo é pedir **só o essencial** (link + como instala) e gerar o `.md` com o
frontmatter **estruturado** que a CLI (`noclaf init`/`sync`) sabe instalar com consentimento.

> Esta é uma skill **de autoria** (`.claude/skills/`), pra trabalhar no conteúdo do noclaf.
> O arquivo que ela cria vive no repo **`noclaf-skills`** (pacote `@noclaf/skills`), sob
> `dependencies/`, e é publicado no npm — não fica no `@noclaf/cli`.

## O que perguntar ao usuário (nesta ordem, pare se faltar algo)

1. **Nome / slug** da dependência (kebab-case, ex.: `ponytail`). Vira o arquivo
   `dependencies/<slug>.md`.
2. **Link do repo** (`repo:`), ex.: `https://github.com/owner/ferramenta`.
3. **Como instala** — UMA das formas abaixo (é o que decide o campo estruturado).
4. **Descrição** curta (1 linha): o que a lib faz / por que o command precisa.

Se o usuário já deu link + forma de instalar, não repergunte — infira o resto.

## Decidir o campo de instalação (allowlist — escolha UM)

O MCP monta o comando a partir de um campo **estruturado e validado** (nunca roda a
string `install:` livre). Mapeie o que o usuário descreveu para exatamente um campo:

| O usuário instala com… | Campo no frontmatter | Vira o comando | Regra de validação |
|---|---|---|---|
| pacote npm global | `npm: <pacote>` | `npm install -g <pacote>` | nome de pacote npm (com escopo `@x/y` opcional) |
| `npx skills add owner/repo` | `skills: <owner/repo>` | `npx --yes skills add <owner/repo>` | slug `owner/repo` |
| clonar repo git | `git: <url>` | `git clone --depth 1 <url>` | **só** `https://github.com/owner/repo` |
| plugin de marketplace / passos no cliente / UI / `/hooks` (NÃO automatizável) | `manual: "<passos>"` | nada — só é impresso | texto livre, uma linha |

Regras duras:

- **Exatamente um** campo de instalação por dependência. `npm` tem precedência sobre
  `skills`, que tem sobre `git`; `manual` é o fallback pra tudo que não dá pra rodar.
- Se a instalação envolve slash-commands do cliente (`/plugin`, `/plugins`, `/hooks`),
  UI do desktop, ou confiança de hooks → é **`manual:`**. Não invente um `npm:`/`git:`.
- `install:` é **opcional e só pra exibição** (espelha o comando real). Nunca é executado.
- URL git que não seja `https://github.com/...` → use `manual:` com o passo de clone,
  senão o MCP rejeita.

## Arquivo a criar: `dependencies/<slug>.md` (no repo `noclaf-skills`)

Frontmatter (inclua só o campo de instalação escolhido):

```yaml
---
title: <Nome legível>
description: <1 linha: o que é / por que o command precisa>
repo: <https://github.com/owner/repo>
# UM destes:
npm: <pacote>
# skills: <owner/repo>
# git: <https://github.com/owner/repo>
# manual: "<passos de instalação em uma linha>"
install: <comando de exibição, ex.: npx skills add owner/repo>   # opcional
---
```

Corpo (siga o padrão dos deps existentes — `ponytail.md` é `manual`, `improve.md` é
`skills`):

```markdown
# <Nome legível>

Dependência **externa** — não faz parte do `@noclaf/cli`. O command <command-que-usa>
depende dela em runtime pra <o que ela faz>.

> <Uma nota sobre a forma de instalar:>
> - Se automatizável (`npm`/`skills`/`git`): "Tem instalador de linha única — no fim
>   do `init`/`sync` a CLI **oferece rodar** com `[y/N]`."
> - Se `manual`: "É plugin/marketplace/UI — a CLI **não automatiza**; ela imprime os
>   passos abaixo."

## Por que é necessária

<Explique o uso concreto pelo(s) command(s).>

## Instalação

<Para npm/skills/git: um bloco de código bash com o comando real.>
<Para manual: os passos por cliente (Claude Code / Codex / Desktop), como no ponytail.>
```

## Como a dependência é descoberta

A declaração é a **presença do arquivo** em `dependencies/`. Não há wikilink nem grafo:
`readDependencies()` lista todo `.md` sob `dependencies/` como um doc `dependency`, e a
CLI oferece instalar cada um no fim do `init`/`sync`. Basta criar o arquivo.

## Depois de criar

1. Rode `noclaf skills status` pra confirmar que o arquivo aparece como `dependency`.
2. No repo `noclaf-skills`: rode `npm run ids` (atribui o id sequencial estável),
   comente, e **republique** o `@noclaf/skills` no npm pra propagar.
3. Faça um dry-run mental: com `npm`/`skills`/`git`, o `init`/`sync` vai **perguntar**
   `[y/N]` antes de instalar; com `manual`, vai só **imprimir** os passos.

## Regras duras

1. **Um** campo de instalação, do allowlist. Em dúvida entre automatizável e manual,
   escolha `manual:` (mais seguro).
2. Nunca coloque comando com shell/pipe/`;`/`$()` num `npm:`/`skills:`/`git:` — esses
   campos são validados por regex estrita e seriam rejeitados. Instrução com shell
   arbitrário vai em `manual:` (texto, não executado).
3. `title` e `description` são obrigatórios; `repo` é fortemente recomendado.
