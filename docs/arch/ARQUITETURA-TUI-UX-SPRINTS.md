# TUI / UX da CLI — plano de sprints (interface Ink `nio ai`)

> **Escopo:** correções e melhorias de UI/UX da interface interativa (`src/tui/`,
> Ink 5 + React 18). 6 sprints, independentes onde possível. Este doc é o mapa —
> cada sprint vira 1 PR.
>
> **Identidade visual travada:** só as **cores** (`src/tui/theme.ts` — verde
> accent) e o **logo** (matrix logo no splash + wordmark `▞ N I O`). Todo o
> resto do layout pode mudar.

---

## Arquitetura atual (o que existe)

```
src/tui/
  launch.tsx        (77)  sobe opencode serve + Headroom + render(<App/>)
  app.tsx          (226)  raiz: stream de eventos SSE, sessão, layout, phase
  components.tsx    (309)  Header · Sidebar · MessageView · LiveMessage · StatusLine · InputBox · SlashList
  state.ts         (182)  applyEvent(evt → ChatState) · syncMessages · modelo ChatPart/ChatMessage
  palette.tsx      (104)  overlays: InfoPanel · CommandRunner · PermissionModal
  palette-source.ts (88)  buildPalette (commander tree + tools nio_* + help)
  opencode.ts       (56)  wrapper do @opencode-ai/sdk + subscribeEvents (SSE, reconecta)
  markdown.tsx      (54)  markdown mínimo → Ink
  theme.ts          (21)  cores + símbolos
```

**Fluxo:** `App` assina `client.event.subscribe()` (SSE) → cada evento passa por
`applyEvent` → `ChatState` → histórico vai pro `<Static>` (scrollback, não
re-renderiza), a última mensagem em andamento vai pra `<LiveMessage>` (altura
limitada a 40% da tela). Input é um `useInput` cru em `<InputBox>`.

**O SDK emite muito mais do que a `applyEvent` consome** — ver Sprint 2.

---

## Sprint 1 — Campo de digitação: bugs + caixa responsiva  ·  ✅ FEITO (2026-09-07)

> **Implementado:** `src/tui/prompt-input.tsx` (novo) — editor controlado com
> cursor navegável, multi-linha com hard-wrap responsivo, atalhos
> (←/→/↑/↓/Home/End via Ctrl-A/E, Ctrl-W/U/K, Ctrl-J, `\`+Enter), paste
> multi-linha sem enviar. `InputBox` (`components.tsx`) delega toda a edição;
> mantém só a lógica da paleta `/` por cima. `app.tsx` passa `width`.
> Helpers puros (`layoutRows`, `cursorRowCol`, `moveVertical`, `wordLeft/Right`,
> `deleteWordBefore`, `lineStart/End`, `sanitizePaste`) testados isolados.
> **14 testes** em `prompt-input.test.tsx` · suíte 525 pass / 0 fail · smoke ao
> vivo (wrap de 67 chars em 3 linhas, cursor inserindo no meio).

### Problema
- **Sem cursor navegável.** `←`/`→` são descartados de propósito
  (`components.tsx:260`); o cursor `▌` fica sempre no fim. Sem Home/End, sem
  pular palavra, sem `Ctrl-A/E`, `Ctrl-W`, `Ctrl-U`.
- **Não é responsiva ao tamanho do texto.** O input é um `<Text
  wrap="truncate-start">` (`components.tsx:299`) — **1 linha só**, e conforme
  você digita ele **corta o começo**. Não quebra linha, não cresce na vertical.
- **Paste quebrado.** `splitOnEnter(input)` pega só a 1ª linha; o resto vira
  `submit()`. `stripControl` derruba tudo `< ' '` (e tem um `ch !== ''`
  suspeito, linha 16). Sem bracketed-paste.
- **Risco de desync.** `valueRef` + `value` (dois estados) sob digitação rápida.

### Causa
`InputBox` é um editor de texto escrito à mão num `useInput`, sem modelo de
cursor nem de linhas.

### Solução
Novo componente `src/tui/prompt-input.tsx` — editor controlado de verdade:
- estado `{ lines: string[], cursor: { row, col } }` (ou string + índice + cálculo de wrap);
- `←/→/↑/↓`, `Home/End`, `Ctrl-A/E`, `Ctrl-W`, `Ctrl-U`, `Alt-←/→`;
- **multi-linha**: `wrap="wrap"`, cresce até N linhas (ex. 6) e depois rola interno;
- cursor renderizado na posição real (inverte o char sob o cursor);
- paste: detectar bloco grande num tick só → insere literal (com `\n`), sem submit;
- `Enter` envia · `Shift-Enter`/`Alt-Enter`/`\` + `Enter` = nova linha;
- histórico de prompts (`↑`/`↓` quando o cursor está na 1ª/última linha e o campo casa) — opcional, fase 2 do sprint.

Trocar dep? Avaliado: `ink-text-input` / `@inkjs/ui` = **só 1 linha, sem
multi-linha**. Não servem. Componente próprio (~150 linhas) é o caminho — é o
coração da UX.

### Arquivos
`src/tui/prompt-input.tsx` (novo) · `src/tui/components.tsx` (InputBox usa o novo) ·
`src/tui/prompt-input.test.tsx` (novo — cursor, wrap, paste, atalhos) ·
`src/tui/app.tsx` (só o wiring)

### Esforço: **M**
### Aceite
Digitar 300 chars → o texto quebra em linhas dentro da caixa, cursor visível,
`←/→/Home/End/Ctrl-W` funcionam, colar 10 linhas insere as 10 sem enviar.

---

## Sprint 2 — Client de IA reflete 100% do motor big-pickle  ·  ✅ FEITO (2026-09-07)

> **Implementado (state.ts + components.tsx + app.tsx):**
> - `ChatPart` ganhou `kind: 'step'`; `tool` carrega `name` + `input` (args) + `output`.
> - `ChatState` ganhou `todos` (`todo.updated`), `files` (`file.edited`, dedup),
>   `retry` (`session.status` type `retry` → `{attempt, note}`).
> - `applyPartInto`: `step-finish` → part `step` com `{tokensIn, tokensOut, cost}`.
> - Seletores puros `summarizeToolInput()` (arquivo/comando/pattern/url) e
>   `messageUsage()` (soma dos steps).
> - Render: `<TodoList>` (☑/◐/☐), `<ToolBlock>` (`● nome(arg) status` + `⎿ saída`),
>   `<UsageFooter>` (`↑1.2k ↓3.4k · $0.012 · N arquivo(s)`), linha de retry,
>   `phase` derivado do estado rico. `LiveMessage` orça a altura (chrome sai do
>   budget de texto; só as últimas 4 tools na área viva, todas no histórico).
>
> **Testes:** 6 novos em `state.test.ts` (todos/files/retry/step/summarize/usage) +
> 2 em `components.test.tsx` (LiveMessage reflete tudo; MessageView com rodapé) ·
> suíte 534 pass / 0 fail · smoke ao vivo do `<LiveMessage>`.
>
> **Deferido (Sprint 2.5 — precisa de opencode ao vivo pra confirmar payload):**
> `message.part.delta` (token-a-token — o snapshot `.updated` já stream-a),
> `session.diff`, sub-agentes (`AgentPart`), `CompactionPart`, `command.executed`.
> Raciocínio completo = Sprint 3.

### Problema
O usuário manda um prompt; o big-pickle processa (decide caminho, chama
ferramentas, faz buscas, edita arquivos, mantém uma lista de tarefas) e a
interface mostra quase nada disso — só "pensando/raciocinando/executando X" +
as últimas linhas do texto final.

### Causa — o que a `applyEvent` **ignora** (o SDK emite, a NIO joga fora)

| Evento / part | O que carrega | Hoje na NIO |
|---|---|---|
| `message.part.delta` | streaming token-a-token | **`continue` explícito** (`app.tsx:113`) → texto vem em blocos |
| `step-start` / `step-finish` | **`tokens {input,output,reasoning,cache}` + `cost` + `reason`** | **`return` cedo** (`state.ts:162`) → zero visibilidade de custo/uso |
| `todo.updated` | a **lista de tarefas / plano** do modelo | **ignorado** — é o item mais importante pra "acompanhar o caminho" |
| `ToolStateRunning.input` | os **argumentos** da tool (qual arquivo, qual comando, qual query de busca) | só mostra `state.title` |
| `ToolState*.output` | o **resultado** da tool | guardado em `ChatPart.tool.output` e **nunca renderizado** |
| `reasoning` (part) | o raciocínio completo | **`slice(-160)`, 1 linha** (`components.tsx:140`) |
| `file.edited` | quais arquivos o modelo tocou | ignorado |
| `session.diff` | o diff das mudanças | ignorado |
| `AgentPart` / subtask | delegação pra sub-agente | ignorado |
| `RetryPart` | tentativas do modelo (rate-limit/erro) | só um bool via `session.status` |
| `command.executed` | comando que o motor rodou | ignorado |
| `CompactionPart` | compactação de contexto | ignorado |

**Estimativa:** a NIO reflete ~30% do que o motor faz.

### Solução
1. **Modelo `ChatPart` expandido** (`state.ts`): novos `kind` — `todo`, `step`,
   `file`, `agent`, `retry`, `patch`. `kind:'tool'` passa a carregar
   `input: Record<string,unknown>` + `output` + `title`.
2. **`applyEvent` consome tudo:** parar de dar `continue`/`return` nos eventos
   acima; mapear cada um pro estado. `todo.updated` vira um bloco de checklist
   (☐/☑) que atualiza in-place.
3. **Deltas:** parar de pular `message.part.delta` — acumular no part e cair pro
   snapshot `.updated` como reconciliação (dedupe por `part.id` + offset).
4. **Render (`components.tsx`):**
   - `LiveMessage` mostra: checklist de todos (topo, fixo) · linhas de tool no
     formato árvore `⏺ Tool(arg resumido)` + `⎿ output (2-3 linhas)` · raciocínio
     (Sprint 3) · texto streamando.
   - `StepFinish` → rodapé compacto: `↑1.2k ↓3.4k · $0.012 · 8s`.
   - `retry` → linha amarela `↻ tentativa 2 (rate limit)`.
5. **`phase`** (`app.tsx:177`) deriva do estado rico em vez de heurística de string.

### Arquivos
`src/tui/state.ts` (grande) · `src/tui/components.tsx` (LiveMessage, MessageView, novo `ToolBlock`, `TodoList`, `StepFooter`) · `src/tui/app.tsx` (phase, não pular delta) · `src/tui/state.test.ts` (cada evento novo)

### Esforço: **G**
### Aceite
Mandar "refatore o arquivo X" → a interface mostra, em tempo real: a checklist
do modelo, cada tool com args e resultado, os arquivos editados, tokens/custo no
fim. Nada que aparece no `NIO_DEBUG=1` fica invisível na tela.

---

## Sprint 3 — Raciocínio expansível ("clicar" pra acompanhar a escrita)  ·  ✅ FEITO (2026-09-07)

> **Implementado (toggle global — Ink não tem clique confiável):**
> - `App`: estado `showReasoning`, alternado por **`Ctrl-R`** (atalho global,
>   inativo quando há overlay/permissão). Hint `^R raciocínio` na sidebar.
> - `LiveMessage` prop `expandReasoning`:
>   - **colapsado** (padrão): `✻ raciocínio Ctrl-R  <tail dim>` — 1 linha, o tail
>     corre enquanto o modelo raciocina.
>   - **expandido**: `✻ raciocínio · N linhas` + o stream inteiro, linha a linha,
>     capado ao budget de altura (rola o conteúdo, não a tela).
> - `MessageView` (histórico): `<ReasoningSummary>` — `✻ raciocínio · N linhas` +
>   as 2 primeiras linhas (antes era 1 linha truncada na largura do terminal).
> - `state.ts`: `session.status` type `busy`/`retry` agora marca `busy=true`
>   (reflete reconexão no meio do stream).
>
> **Testes:** `components.test.tsx` (colapsado × expandido; ReasoningSummary no
> histórico) · `app.test.tsx` (Ctrl-R alterna) · suíte 537 pass / 0 fail · smoke
> ao vivo.

### Problema
O raciocínio do modelo (por que seguir tal caminho) aparece cortado em 160 chars,
1 linha, sem como ver o resto.

### Causa
`components.tsx:140` (`LiveMessage`) e `:99` (`Part`) fazem `slice(-160)` /
`truncate-end`. O texto completo **está** no estado (`part.text`), só não é exibido.

### Solução
Terminal não tem clique confiável no Ink → **foco + tecla**:
- linha colapsada: `✻ raciocínio · 12 linhas  [→ expandir]`;
- estado `expandedReasoning: Set<partId>` no `App` (ou um toggle global
  `Ctrl-R` / tecla `r`);
- expandida: mostra o stream completo do raciocínio, com wrap, dentro do teto de
  altura da área dinâmica (rola o conteúdo, não a tela);
- na **mensagem viva**, expande/colapsa ao vivo enquanto o modelo raciocina;
- no **histórico** (`<Static>`), vai colapsado com o resumo — reabrir =
  `/reasoning <msg>` (comando) que re-renderiza aquela mensagem expandida abaixo.

Alinhado com o "✻ Thinking…" expansível do Claude Code (Sprint 4).

### Arquivos
`src/tui/components.tsx` (Reasoning colapsável) · `src/tui/app.tsx` (estado de expand + tecla) · `src/tui/state.ts` (garantir que reasoning nunca é truncado no modelo)

### Esforço: **M** (P se for só toggle global)
### Aceite
Enquanto o modelo raciocina, apertar `r` (ou navegar até a linha e Enter) abre o
raciocínio completo, scrollável; apertar de novo colapsa.

---

## Sprint 4 — Layout no estilo Claude Code (cores + logo NIO mantidos)  ·  ✅ FEITO (2026-09-07)

> **Implementado:**
> - **Sidebar removida** (era 26 colunas fixas). Fluxo vertical puro, input
>   full-width (`width = columns - 6`).
> - `<Header>` removido. Novo **`<Footer>`** (2 linhas, `paddingX=1`): linha 1 =
>   `⏵ big-pickle · <pasta> · <sessão · perfil> · <tokens> [modo]`; linha 2 =
>   atalhos (`/ paleta   ^R raciocínio   Tab modo   Esc abortar   ^C sair`).
> - Marcadores tipo Claude Code: `> você` / `⏺ nio` (`Author`).
> - Total de tokens da sessão somado no App (`messageUsage` de cada mensagem).
> - Splash (matrix logo) e `theme.ts` (verde) **inalterados**.
> - `session.list` / estado `sessions` removidos (a lista "outras sessões" saiu).
>
> **Testes:** `components.test.tsx` (Footer) · `app.test.tsx` (sem sidebar, rodapé
> com modelo/sessão) · smoke ao vivo.

### Problema
Layout atual: **sidebar fixa de 26 colunas** (Sessão / Outras sessões / Atalhos)
+ coluna direita. Ocupa espaço, destoa do que os devs esperam de um CLI de
agente.

### Alvo (Claude Code)
- **Sem sidebar.** Fluxo vertical puro, largura cheia.
- Mensagens: `⏺` (assistant) / `>` (user); tool calls em árvore `⏺ Tool(args)` →
  `⎿ resultado`.
- **Rodapé compacto** (1 linha): `modelo · cwd · tokens · modo` (substitui a
  sidebar).
- Status line fina enquanto processa.
- `? atalhos` no rodapé; painel de atalhos sob demanda.
- Splash: mantém o **matrix logo** + `operador NIO · big-pickle`.
- Cores: **nada muda** em `theme.ts`.

### Solução
- Remover `<Sidebar>` do `app.tsx`; migrar a info de sessão pra:
  - `<Footer>` novo (1 linha, compacto), e
  - comando `/status` (painel sob demanda com as outras sessões).
- `MessageView` / `LiveMessage` reescritos no formato árvore.
- `Header` some ou vira parte do `<Footer>`.
- Novo `<Shortcuts>` (painel `?`).
- `app.tsx` layout: `<Static>` (histórico) → área viva → `<Footer>` → `<InputBox>`.

### Arquivos
`src/tui/app.tsx` (layout) · `src/tui/components.tsx` (Sidebar→Footer, MessageView, Header) · `src/tui/shortcuts.tsx` (novo) · `src/tui/components.test.tsx` · `src/tui/app.test.tsx`

### Esforço: **G** (mexe nos mesmos arquivos do Sprint 2/3 — **fazer junto ou logo depois**)
### Aceite
`nio ai` abre sem sidebar; sessão/modelo/tokens no rodapé de 1 linha; tool calls
em árvore; identidade NIO (verde + logo) intacta.

---

## Sprint 5 — `Tab` troca de modo (plan / build / …) como no opencode  ·  ✅ FEITO (2026-09-07)

> **Implementado:**
> - `opencode.ts` `listPrimaryAgents(client)` → `client.app.agents()`, filtra
>   `mode !== 'subagent'`, fallback `['build', 'plan']`.
> - `App`: estados `modes` / `mode`, buscados no boot. `cycleMode(reverse)`.
> - `PromptInput` prop `onTab` → `key.tab` chama `onTab(key.shift)` (era descartado).
>   `InputBox` repassa via `onCycleMode`.
> - `send()` passa `body.agent = mode` no `session.prompt`.
> - Pill `[modo]` no `<Footer>` + hint `Tab modo` na linha de atalhos.
>
> **Testes:** `app.test.tsx` (Tab cicla build⇄plan, subagent fora do ciclo, o
> prompt vai com `agent: 'plan'`) · smoke ao vivo · suíte 538 pass / 0 fail.

### Problema
Não dá pra alternar entre modos do agente. `Tab` é **descartado**
(`components.tsx:260`).

### Viável? Sim — o SDK suporta
- `SessionPromptData.body.agent: string` — passa o modo/agente por prompt.
- `client.agents()` — lista os agentes disponíveis (`mode: 'primary' | 'subagent' | 'all'`).
- Há até o comando de TUI `agent_cycle`.

### Solução
- `App` busca `client.agents()` no boot → filtra `mode !== 'subagent'` → lista de modos.
- Estado `mode` (default = 1º da lista, ou `build`).
- `Tab` no `InputBox` → cicla `mode` (`Shift-Tab` volta). Remove o `key.tab` do
  guard de descarte.
- `send()` (`app.tsx:139`) passa `body: { agent: mode, parts, model }`.
- Modo atual visível: pill na borda do input (`[plan]`) + no `<Footer>`.
- Persistir o último modo por sessão? Opcional (`nio.user.json` ou memória de sessão).

### Arquivos
`src/tui/app.tsx` (estado mode, agents(), send) · `src/tui/components.tsx` (InputBox: Tab + pill) · `src/tui/opencode.ts` (helper `listAgents`) · testes

### Esforço: **M**
### Aceite
`Tab` alterna `build ⇄ plan` (e outros que o opencode expõe); o modo aparece na
interface; o prompt seguinte roda no modo escolhido.

---

## Sprint 6 — Paleta `/`: executar de verdade + abrir/fechar sem quebrar  ·  ✅ FEITO (2026-09-07)

> **Implementado:**
> - **Enter num comando RODA** — `defaultPaletteAction()` (`components.tsx`):
>   `capability→prompt`, `command→run`, `help→info`. Confirmação só pros
>   `destructive` (o `CommandRunner` já fazia).
> - **`<InputBox>` nunca desmonta** — o rascunho virou `draft` no `App`
>   (controlado: `value`/`onChange`), sobrevive a abrir/fechar overlay e ao
>   modal de permissão. Overlays (`InfoPanel`/`CommandRunner`/`PermissionModal`)
>   renderizam **abaixo** do input, não no lugar.
> - **Foco único** — `PromptInput` ganhou `active` → `useInput({ isActive })`.
>   Com overlay aberto: input inativo (mostra o rascunho, borda dim, sem cursor);
>   o `useInput` do App (Esc = abortar) fica `isActive: sem overlay`.
> - **Altura estável** — droplist capada a `min(6, rows-16)` itens; a área viva
>   (`liveMax`) encolhe quando a paleta abre, pra o total nunca corromper o Ink.
>
> **Testes:** `components.test.tsx` (Enter em comando → `run`; `active=false` →
> sem droplist) · `app.test.tsx` (rascunho sobrevive ao modal de permissão) ·
> suíte 527 pass / 0 fail · smoke ao vivo (`/whoami` + Enter → runner abre
> abaixo do input, footer "Enter roda").

### Problema
1. **`/comando` + Enter não executa.** Hoje: `capability` + Enter → manda pro
   agente ✅; **`command` + Enter → abre `InfoPanel`** ("rode: nio X") ❌ — só
   `Ctrl-R` roda (`components.tsx:257`, `app.tsx:150`). O usuário espera Enter =
   executar.
2. **Abrir/fechar a droplist quebra a interface.** O overlay
   (`InfoPanel`/`CommandRunner`) **substitui o `<InputBox>` inteiro** no ternário
   `app.tsx:213-221`. Ao fechar, o `InputBox` **re-monta com estado zerado** →
   perde o texto digitado, `sel`/cursor resetam. A lista `/` aparecendo/sumindo
   também **muda a altura** da área dinâmica → o `<Static>` "pula".

### Causa
- Ação default por `kind` errada: `command` deveria ser "run", não "info".
- `overlay` como estado que troca o componente raiz do input, em vez de uma
  camada sobreposta.
- `useInput` de App + overlay + InputBox ativos ao mesmo tempo (sem foco explícito).

### Solução
1. **Ação default:**
   - `capability` + Enter → prompt pro agente (mantém)
   - `command` + Enter → **roda** (`CommandRunner`); confirmação só pros `destructive`
   - `help` + Enter → InfoPanel
   - `Ctrl-R` deixa de ser necessário (fica como atalho alternativo)
2. **`<InputBox>` nunca desmonta.** A droplist e os overlays viram **camada**
   abaixo do input (mesma árvore), não um `if/else` que troca o input. O draft
   fica preservado (guardar `value` no `App`, não no `InputBox`, ou `key` estável).
3. **Altura estável.** Reservar as ~10 linhas da droplist (ou `minHeight`), pra
   abrir/fechar não empurrar o `<Static>`.
4. **Foco único.** Enquanto a droplist/overlay está aberta, o `useInput` do App
   (Esc = abortar) fica **inativo** (`isActive: !paletteOpen`); só um handler
   ativo por vez.
5. **Fechar = `Esc`** volta pro input **com o texto que estava lá** (ou limpo, se
   foi submit).

### Arquivos
`src/tui/app.tsx` (overlay → camada, draft no App, isActive) · `src/tui/components.tsx` (InputBox não desmonta, SlashList altura fixa) · `src/tui/palette.tsx` (overlays como camada) · `src/tui/app.test.tsx` (abrir `/`, digitar, Esc → texto preservado; Enter em command → roda)

### Esforço: **M**
### Aceite
Digitar `/dep` → Enter em `deps` **roda** `nio deps`; digitar texto, abrir `/`,
apertar Esc → o texto continua lá; abrir/fechar a droplist não faz o histórico
pular.

---

## Camada de teste  ·  ✅ FEITO (2026-09-07)

Rodar tudo: `bun test` · só a TUI: `bun test src/tui` · um caso: `bun test -t "reflete o motor"`.

**Bug que apareceu como "5 testes flaky":** os testes de `ink-testing-library`
passavam com `bun test | pipe` / CI e **falhavam** quando o dono rodava `bun test`
direto no terminal. Causa: sob um **TTY real** o Ink pinta com ANSI e desenha o
cursor como `<Text inverse>` no meio da string, então `frame.includes('hello')`
ou `'read(src/core/messaging.ts)'` quebra (tem um `\x1b[..m` no meio). Piped/CI o
Ink já manda texto puro. **Não era carga de máquina.**

**Fix:** `src/tui/test-utils.ts`
- `stripAnsi(s)` — tira `\x1b[..m`; aplicado em `waitForFrame`, `waitForText`, `frameOf`.
- `waitForFrame(frame, pred, {timeoutMs=2000})` / `waitForText(frame, needles)` —
  polling até bater (o Ink faz throttle da 1ª pintura; sleep fixo era frágil).
- `frameOf(<el/>)` — `render` + espera assentar + frame sem ANSI. Para componente puro.
- `matrix-logo.test.ts` "fora de TTY": forçava `isTTY` implícito — agora força
  `isTTY=false` no `Object.defineProperty` (igual ao teste irmão que força `true`).

Suíte: **552 pass / 0 fail** com pipe **e** com TTY real (`script -q /dev/null bun test`).

---

## Sequenciamento recomendado

```
Sprint 1  (input)        ─ independente, alto impacto        → 1º
Sprint 6  (paleta /)     ─ independente, bug visível         → 2º
Sprint 2  (reflexo motor)─ base pro 3 e 4                     → 3º  ┐
Sprint 3  (raciocínio)   ─ encaixa no 2                       → 4º  │ mesmos arquivos —
Sprint 4  (layout CC)    ─ reescreve components com 2+3       → 5º  ┘ podem virar 1 épico
Sprint 5  (Tab modos)    ─ independente, pequeno              → junto do 4 (pill no footer)
```

- **1 e 6** primeiro: isolados, consertam dor imediata, não conflitam com nada.
- **2 → 3 → 4** mexem todos em `state.ts` + `components.tsx` — fazer em sequência
  (ou como um épico de 3 PRs) evita retrabalho de merge.
- **5** é pequeno e encaixa no rodapé que o 4 cria.

---

## Fora de escopo (registrar)

- Reescrever o `markdown.tsx` pra um parser completo (tabelas, listas aninhadas,
  links) — melhoria separada, não bloqueia nada.
- Mouse/scroll no terminal — Ink não suporta de forma confiável cross-terminal.
- Temas alternativos / customização de cor pelo usuário — identidade é fixa (verde + logo).
- Substituir Ink por outra lib (blessed, opentui) — o Ink atende; risco alto, ganho incerto.
- Editor de múltiplos buffers / abas — não é um editor, é um chat de agente.

---

## Ligações

- `src/tui/*` — o código
- `@opencode-ai/sdk` `types.gen.d.ts` — a fonte de verdade dos eventos/parts
- `docs/arch/ARQUITETURA-CLIENTE-TUI.md` — arquitetura atual da TUI (se ainda existir após a reorg de docs)
- `NIO_DEBUG=1` — loga cada evento cru do opencode (`src/tui/debug.ts`)
