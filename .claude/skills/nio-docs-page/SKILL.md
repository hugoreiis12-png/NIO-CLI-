---
name: nio-docs-page
description: Mantém a página HTML da documentação da CLI (`nio docs --html`), gerada por `src/cli/commands/docs/html.ts`. Use quando for adicionar/editar seções da doc, mexer no visual da página, ou quando o conteúdo do `nio docs` sair do lugar. É uma skill de AUTORIA — trabalha no fonte do `@nio-cli/cli`, não no repo de skills.
---

# Página da documentação (`nio docs --html`)

O comando `nio docs` tem duas saídas da **mesma fonte**:

| Arquivo | Papel |
|---|---|
| `src/cli/commands/docs/content.ts` | prosa das seções (`SECTIONS`) + `TAGLINE`. **Fonte da verdade do texto.** |
| `src/cli/commands/docs/dynamic.ts` | seções geradas ao vivo: tabela de comandos (do `program` do commander) e tools MCP (de `toolDefinitions`). Nunca editar à mão — reflete o que a CLI expõe. |
| `src/cli/commands/docs/terminal.ts` | render pro terminal (cores do `colors.ts`, sem largura fixa). |
| `src/cli/commands/docs/html.ts` | render pra página — **o design mora aqui**. |
| `src/cli/commands/docs.ts` | registro do comando (`--html` / `--open` / `--out`). |

## Editar conteúdo

1. Texto novo → adicione um `DocSection` em `SECTIONS` (`content.ts`). `blocks` aceita
   `p` (parágrafo, aceita `\`código\``), `code`, `list`, `table`.
2. Novo comando/tool aparece **sozinho** nas tabelas dinâmicas — não duplicar em `content.ts`.
3. Rode `bun run build && node dist/cli.js docs` e `… docs --html --open` pra conferir as duas.

## Design da página (`html.ts`)

O alvo é uma doc **utilitária e polida** — não landing page. Aplique o espírito do
`artifact-design` do Claude, calibrado pra documento:

**Paleta** (tokens em `:root`, redefinidos em `@media (prefers-color-scheme:dark)` sob
`:root:not([data-theme=light])` **e** em `:root[data-theme=dark]` pro toggle):

| token | claro | escuro | papel |
|---|---|---|---|
| `--bg` | `#f6f8f5` | `#0a0e0b` | fundo (fósforo esverdeado, nunca cinza puro) |
| `--ink` | `#16211a` | `#d7e5da` | texto |
| `--muted` | `#5a6b60` | `#7f9285` | secundário |
| `--accent` | `#1a7f43` | `#4ade80` | verde NIO — links, `code`, rail ativo |
| `--code-bg` | `#0d130f` | `#060907` | bloco de código (escuro nos dois temas — é terminal) |

**Tipo:** `--font` grotesca de sistema (`Inter` como 1ª opção, fallback real); `--mono`
`ui-monospace/SF Mono/JetBrains Mono` — o wordmark `nio_` e todo código são mono.
Medida de leitura ~70ch (`p{max-width:70ch}`).

**Layout:** header full-bleed (wordmark + tagline + pill de versão + toggle de tema);
`.wrap` em grid `220px / 1fr` — rail de navegação sticky à esquerda (some < 820px),
coluna de conteúdo à direita. Seções com `scroll-margin-top`.

**Regras duras:**
- **Zero request externo.** Sem `<link>`, sem `<script src>`, sem `@import`, sem
  Google Fonts. Tudo inline. (A página é aberta como arquivo local, e tem que
  funcionar offline.)
- **Theme-aware nos 3 estados**: sistema (só `prefers-color-scheme`), `data-theme=light`,
  `data-theme=dark`. `body` sempre pinta `background` de token.
- Conteúdo largo (tabela, `pre`) rola no próprio container (`overflow-x:auto`), o
  `body` nunca rola na horizontal.
- `escape` em todo texto interpolado; `inline()` só libera `<code>` de `\`crases\``.
- `localStorage` do tema em `try/catch` (pode lançar / vir vazio).

## Verificação

- `bunx tsc --noEmit` verde; `bun test` sem regressão.
- `node dist/cli.js docs --html --out /tmp/d.html` → abrir e conferir claro **e** escuro
  (toggle + DevTools "Emulate prefers-color-scheme").
- `grep -E '<(link|script|img)[^>]*(src|href)=' /tmp/d.html` → vazio.
- README: `bun run gen:docs` mantém a linha `docs` na tabela de comandos.
