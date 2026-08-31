---
id: "0008"
title: Interface NIO própria (Ink) sobre o opencode serve
status: accepted
created: 2026-08-31
---

# Interface NIO própria (Ink) sobre o `opencode serve`

## Contexto

Fase 1 ([ADR 0007](0007-headroom-proxy-obrigatorio.md)): `nio ai` sobe o Headroom e
**entrega o terminal pra TUI do OpenCode** — interface do OpenCode, marca do OpenCode.
O dono quer a **interface do NIO**: mesma estética, logo nosso, **descrições da
barra lateral em verde**, e uma **paleta `/`** com os comandos e capacidades do NIO.
O motor continua `opencode/big-pickle`.

## Decisão

- **Ink, não OpenTUI.** OpenTUI (a lib da TUI do próprio OpenCode) exige **Bun**
  (FFI Zig via `bun:ffi`; Node só ≥26 com `--experimental-ffi`) — conflita com a
  regra "Node é o alvo" do `CLAUDE.md` e com o `npm i -g`. **Ink** é React-para-
  terminal, **Node puro**, maduro (`ink@5.2`, Node ≥18). Fica *parecido*, não
  idêntico — trade-off aceito pelo dono.
- **Motor = `opencode serve` headless + `@opencode-ai/sdk`** (`createOpencodeServer`
  + `createOpencodeClient`). O server lê o `~/.config/opencode/opencode.json`
  (model `big-pickle` + `provider.opencode.options.baseURL` = Headroom, gravados por
  `ensureHeadroomAndWire`). A UI é nossa: splash (logo Matrix), sidebar verde, chat
  streamado (SSE via `client.event.subscribe()`), cards de tool-call, paleta `/`,
  modal de permissão.
- **O swap** (ADR 0007 prometeu que só o corpo mudaria):
  - `src/app/ai-client.ts` `launchAiClient` volta a ser **só headless** (`opencode run`)
    — segue o `nio docker debug/orquest/cluster` (`runOperator`). Exporta `ensureHeadroomAndWire`.
  - `src/tui/launch.tsx` `launchNioTui({ cwd })` — o branch interativo. `nio ai` e o
    handoff do `nio init` chamam ele (import **lazy** — Ink/React só carregam aí).
  - Degrada pra TUI do OpenCode se: não-TTY, sem `opencode` no PATH, ou o server não sobe.
- **Paleta `/`** — 3 ações (pedido do dono): comando → painel de info · comando →
  `Ctrl-R` executa `nio <cmd>` e mostra a saída (confirma antes se destrutivo) ·
  capacidade (tool `nio_*`) → manda um prompt-template pro agente. Fonte:
  `buildPalette(program)` sobre a árvore viva do commander (`src/cli/program.ts`
  `buildProgram()`, novo) + `toolDefinitions` + as `SECTIONS` de `content.ts`.
- **Fatiamento**: esta é a **fatia 2a** (splash · sidebar verde · sessão · chat
  streamado · tool-cards · paleta · permissão allow/deny). **2b** (plano próprio):
  diff viewer, file tree, seletor de modelo/agente, attachments, revert/edit, mouse,
  cheatsheet, trocar de sessão pela sidebar, animação do logo.

## Consequências

**Positivas:**
- Interface NIO ponta a ponta sem reimplementar o motor (agente, tools, providers,
  LSP, diffs, permissões seguem no `opencode serve`).
- `src/tui/` é isolado e lazy — `nio --help` e os outros comandos não pagam Ink/React.
- `buildProgram()` (extraído do `cli.ts`) dá uma fonte única da árvore de comandos
  pra TUI e futuramente pro `gen-reference`.

**Negativas / trade-offs:**
- **Não fica pixel-perfeito com o OpenCode** — Ink ≠ OpenTUI. Aceito.
- **Primeiras deps React do projeto** (`ink`, `react`, `@opencode-ai/sdk`) — em
  `dependencies` (todas Node puro). `tsconfig` ganha `"jsx": "react-jsx"`.
- **`@opencode-ai/sdk` acompanha a versão do `opencode`** — pinado em `1.18.x`
  (casa com o `opencode` do momento); divergência grande → a TUI degrada.
- **Primeiro consumidor de raw-mode/alt-screen de vida-longa** no projeto — até aqui
  só o `@clack/core` (transiente). Sinais/resize/teardown de stdin são território novo.
- A fatia 2a é um **esqueleto funcional** — o loop de eventos do SDK e o markdown
  precisam de afinação ao vivo (passo "Sua parte" do plano).

## Alternativas consideradas

- **OpenTUL agora** — descartado: dependência de Bun.
- **Bump do `nio` inteiro pra Bun** — descartado: quebra `npm i -g` em Node.
- **Manter a TUI do OpenCode + só rebrandar via config** — o OpenCode não expõe
  troca de logo/nome; e o dono quer a paleta `/` do NIO, que não existe lá.

## Referências

- `src/tui/` (Ink), `src/app/ai-client.ts`, `src/cli/program.ts`.
- `docs/arch/ARQUITETURA-CLIENTE-TUI.md` — desenho detalhado + 2b.
- [ADR 0007](0007-headroom-proxy-obrigatorio.md) (Headroom), [ADR 0004](0004-operador-ia-unico.md) (operador único).
- https://github.com/vadimdemedes/ink · https://opencode.ai/docs/sdk
