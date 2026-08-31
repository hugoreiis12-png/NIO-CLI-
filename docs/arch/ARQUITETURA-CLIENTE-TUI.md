# Interface NIO (Ink) — Fase 2

> **Fatia 2a implementada (31 ago 2026)** — [ADR 0008](../adr/0008-interface-nio-ink.md).
> `nio ai` deixa de spawnar a TUI do OpenCode: sobe `opencode serve` headless e
> renderiza a interface NIO em **Ink** (React p/ terminal, Node puro). O que falta
> (2b) está no fim.

## Arquitetura

**Ink ↔ `opencode serve` via `@opencode-ai/sdk`.** OpenCode roda **headless** como
servidor (agente, tools, providers, LSP, diffs, permissões, sessões); a interface é
nossa.

> **Por que Ink e não OpenTUI** (a lib da TUL do próprio OpenCode): OpenTUI exige
> **Bun** (FFI Zig via `bun:ffi`; Node só ≥26 com flag experimental) — quebraria o
> `npm i -g` em Node e a regra "Node é o alvo". Ink roda em Node ≥18. Fica
> *parecido*, não idêntico. Ver ADR 0008.

```
nio ai / handoff do nio init
  └─ launchNioTui({ cwd })                       src/tui/launch.tsx
       ├─ ensureHeadroomAndWire()                (Fase 1 — Headroom + baseURL no opencode.json)
       ├─ startOpencode(cwd)                     src/tui/opencode.ts
       │    createOpencodeServer({ port: 0 })  → opencode serve headless (lê o opencode.json)
       │    createOpencodeClient({ baseUrl })
       └─ render(<App/>)  (Ink)                  src/tui/app.tsx
            Splash (renderMatrixLogo) · Sidebar (verde) · MessageList · InputBar
            Palette (/) · InfoPanel · CommandRunner · PermissionModal
       degrada → TUI do OpenCode  (sem TTY / sem opencode / server não sobe)
```

O branch **headless** (`nio docker debug/orquest/cluster` → `runOperator`) segue em
`launchAiClient` (`src/app/ai-client.ts`), spawnando `opencode run` — inalterado.

## Arquivos (`src/tui/`)

| Arquivo | Papel |
|---|---|
| `launch.tsx` | `launchNioTui` — server + client + `render`, fallback, `resolveSessionMeta` |
| `opencode.ts` | `startOpencode`, `subscribeEvents` (async-iterator do SSE) |
| `state.ts` | `ChatState` + `applyEvent` (normaliza os `Event` do SDK, defensivo) |
| `app.tsx` | raiz: splash → sessão → loop de eventos → chat/paleta/permissão |
| `components.tsx` | `Header`, `Sidebar` (**descrições em verde**), `MessageList`, `ToolCard`, `InputBar` |
| `palette.tsx` | `Palette` (`/`), `InfoPanel`, `CommandRunner`, `PermissionModal` |
| `palette-source.ts` | `buildPalette(program)` / `filterPalette` — puro, testável |
| `markdown.tsx` | markdown mínimo → Ink (bold, code, fences, títulos) |
| `theme.ts` | tokens (accent = verde) |

Fonte da paleta: `buildProgram()` (`src/cli/program.ts`, extraído do `cli.ts`) +
`toolDefinitions` (`src/tools/index.ts`) + `SECTIONS` (`content.ts`).

## Paleta `/` — as 3 ações (pedido do dono)

- **comando `nio` + Enter** → painel de info (o que faz + a linha `nio <cmd>` exata).
- **comando `nio` + Ctrl-R** → executa `nio <cmd>` num sub-painel e mostra a saída
  (confirma antes se destrutivo: `delete`/`clean`/`logout`/`disable-2fa`/`… down`).
- **capacidade (tool `nio_*`) + Enter** → manda um prompt-template pt-BR pro agente,
  que usa a tool via o MCP `nio` (já registrado no `opencode.json`).

## Fatia 2a — o que entrou

Splash (logo Matrix estático) · sidebar verde (sessão · sessões · atalhos) · cria a
sessão no start · chat com streaming (`message.part.updated`) · cards de tool-call ·
paleta `/` (3 ações) · modal de permissão (`a`/`s`/`d`) · `Esc` aborta · `Ctrl-C`
fecha o server (sem órfão).

> A fatia 2a é um **esqueleto funcional**. O mapeamento exato dos `Event` do SDK e o
> markdown precisam de afinação ao vivo (as formas do `Event` variam entre versões
> do opencode; `state.ts` lê defensivo e `NIO_DEBUG=1` loga o evento cru).

## Fatia 2b — pendente (plano próprio)

- Diff viewer (partes `patch`/`diff`), file tree + viewer.
- Seletor de modelo/agente (`client.config.providers`, `client.session.update`).
- Attachments (`FilePartInput`), revert/edit de mensagem (`session.revert`).
- Trocar de sessão pela sidebar (↑↓+Enter), retomar sessão vinculada ao `nio.json`.
- Animação Ink do logo no splash, mouse, cheatsheet de teclas, `session.share`.
- Bump pra `ink@7` (exige Node ≥22) quando o `engines` subir.

## Riscos

- **Ink ≠ pixel-perfeito com o OpenCode** — aceito.
- **`@opencode-ai/sdk` acompanha a versão do `opencode`** — pinado `1.18.x`.
- **Primeiro raw-mode/alt-screen de vida-longa** no projeto — sinais/resize/teardown.
- Testes automatizados: `palette-source`, `components` (ink-testing-library), `app`
  (fake handle). O render interativo + streaming é verificado ao vivo.

## Referências

- `src/tui/`, `src/app/ai-client.ts`, `src/cli/program.ts`.
- [ADR 0008](../adr/0008-interface-nio-ink.md), [ADR 0007](../adr/0007-headroom-proxy-obrigatorio.md).
- https://github.com/vadimdemedes/ink · https://opencode.ai/docs/sdk
