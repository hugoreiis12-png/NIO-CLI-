# Interface NIO em OpenTUI — Fase 2 (ESBOÇO / a planejar)

> ⚠️ **Não implementado.** A Fase 1 ([ADR 0007](../adr/0007-headroom-proxy-obrigatorio.md))
> entregou o `nio ai` (Headroom + handoff + terminal na IDE) usando **a TUI do
> OpenCode** como interface. Este doc é o desenho da Fase 2: substituir essa TUI
> por uma interface **NIO** própria. Vira plano detalhado quando o dono priorizar.

## Objetivo

O `nio ai` deixa de spawnar a TUI do OpenCode. Passa a renderizar uma interface
**NIO** — mesma estética e funcionalidades do OpenCode, com a marca NIO (splash
com o logo Matrix animado, tema, nome "NIO").

## Arquitetura (decisão do dono, 31 ago 2026)

**OpenTUI ↔ `opencode serve` via `@opencode-ai/sdk`.** O OpenCode roda **headless**
como servidor (agente, tools, providers, LSP, diffs, permissões, sessões); a
interface é nossa. É como o próprio OpenCode funciona hoje (TUI Go ↔ server TS) —
a gente troca a TUI Go pela nossa em OpenTUI.

```
nio ai
  ├─ ensureHeadroomRunning()                 (já existe — Fase 1)
  ├─ spawn('opencode', ['serve','--port',N]) headless, background
  ├─ @opencode-ai/sdk  → client no http://127.0.0.1:N
  │    (o server é que fala com o Headroom; o baseURL do provider já aponta pra lá)
  └─ app OpenTUI (@opentui/core | @opentui/solid)
       splash NIO · lista de sessões · chat streamado · tool-calls · permissões
```

## Escopo por incremento

- **MVP:** splash (reusa `animateMatrixLogo`), tema NIO, nome; lista de sessões;
  chat com streaming; render de tool-calls; prompts de permissão. Uma sessão viva
  ponta a ponta.
- **Paridade:** diff viewer, file tree, seletor de modelo/agente, attachments,
  `/comandos`, LSP hover.
- **Fora:** reescrever o motor do agente (é o `opencode serve`); rodar sem OpenCode.

## Riscos

- **OpenTUI é pré-1.0** — API instável, churn.
- **`@opencode-ai/sdk` acompanha a versão do `opencode`** — pinar e testar em CI.
- **"Mesmas funcionalidades" = esforço contínuo** — entregue por incremento, não de uma vez.
- **Deps novas de runtime "pesadas"** (`@opentui/core` + `@opencode-ai/sdk`) — as
  primeiras do projeto; avaliar bundle e `package.json` `files`.
- Ciclo de vida do `opencode serve` (start/stop/porta/órfão) — precisa de um
  supervisor leve, como o `ensureGatewayRunning`/`ensureHeadroomRunning`.

## Referências

- `src/cli/commands/ai.ts`, `src/app/ai-client.ts` — o ponto de troca (Fase 1 spawna
  a TUI; Fase 2 spawna `serve` + renderiza).
- https://opencode.ai/docs (server / SDK) · https://github.com/sst/opentui
- [ADR 0007](../adr/0007-headroom-proxy-obrigatorio.md) — Fase 1.
