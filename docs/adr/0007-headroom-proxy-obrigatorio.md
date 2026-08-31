---
id: "0007"
title: Headroom como proxy obrigatório do client de IA
status: accepted
created: 2026-08-31
---

# Headroom como proxy obrigatório do client de IA

## Contexto

O `nio init` termina abrindo a IDE numa janela e a TUI do OpenCode noutra tela —
duas superfícies, interface não é nossa — e **nenhuma camada entre o agente e o
LLM**: cada chamada de modelo vai crua.

`ARQUITETURA-CLIENTES-MULTI-FUTURO.md` (Parte B, parkeada) já desenhava o Headroom
(`ghcr.io/headroomlabs-ai/headroom`, Apache 2.0) — um proxy de **compressão de
contexto** ("economizador de token", 60–95% em JSON, ~20% em agentes de código) —
integrado como container Docker no formato do Kong. O dono agora pediu isso como
Fase 1, **obrigatório**, e o client abrindo **dentro de um terminal da IDE**.

Spike (2026-08-31) confirmou: a imagem tem entrypoint `headroom proxy`; com
`OPENAI_TARGET_API_URL=https://opencode.ai/zen/v1` ela roteia `/v1/chat/completions`
e `/v1/responses` pro OpenCode Zen; o header `Authorization` do OpenCode passa
transparente (Headroom não precisa de API key própria); e o OpenCode respeita
`provider.opencode.options.baseURL` no `opencode.json`. `opencode/big-pickle` segue
válido no catálogo Zen.

## Decisão

- **`nio ai`** (novo) é o ponto único de "subir o client de IA": `launchAiClient()`
  (`src/app/ai-client.ts`) sobe o Headroom (`docker compose -f headroom/... up -d`,
  espera o `/livez`), grava `provider.opencode.options.baseURL = <HEADROOM_URL>` no
  `~/.config/opencode/opencode.json`, e entrega o terminal pro `opencode`.
- **Headroom é obrigatório pro `nio ai`**: sem ele no ar (sem Docker), `nio ai`
  para com erro acionável (`HeadroomRequiredError`). O `nio init` **não morre** —
  materializa o ambiente e deixa a linha `nio ai` pra retomar.
- **Container NIO-gerenciado**: `headroom/docker-compose.yml` (espelha `docker/` e
  `kong/`), shipado no pacote (`package.json` `files`), resolvido por
  `headroomComposePath()`. `nio docker headroom {up,down,status}` = superfície manual.
- **Terminal dentro da IDE**: `nio init` (IDE vscode/cursor) grava
  `<projeto>/.vscode/tasks.json` — task `NIO`, `command: "nio ai"`,
  `runOptions.runOn: "folderOpen"` — + `settings.json` `"task.allowAutomaticTasks": "on"`.
  Abre a IDE e para; o terminal integrado sobe o `nio ai`. Sem IDE (`terminal`/`other`)
  ou IDE indisponível → `nio ai` no terminal atual. `.vscode/` só entra no
  `.gitignore` quando a CLI cria o `tasks.json` (respeita quem já versiona `.vscode/`).
- **`nio docker debug/orquest/cluster`** (`runOperator`) passam pelo mesmo
  `launchAiClient` (headless) — também via Headroom.

## Consequências

**Positivas:**
- Toda chamada de modelo do client passa pelo compressor — menos token, mais
  cache-hit, base pronta pro ladder de failover (Parte C).
- Uma superfície (IDE) em vez de duas (IDE + janela do OpenCode).
- `nio ai` é reutilizável (task da IDE, handoff do init, retomada manual, headless
  do docker) — um lugar só pra evoluir (a Fase 2 trocou o `spawn opencode` pela
  interface NIO em Ink, sem mexer nos call-sites — ADR 0008).

**Negativas / trade-offs:**
- **Reverte a premissa "nenhum LLM passa pela CLI"** de `ARQUITETURA-GATEWAY.md` —
  de propósito. Doc atualizado.
- **Docker vira requisito do client de IA.** Quem não tem Docker termina o `nio init`
  (ambiente materializado) mas não abre o `nio ai`. Aceito: é o pedido ("obrigatório").
- O lock de modelo continua soft (herança da ADR 0004).
- `--host 0.0.0.0` dentro do container + publish `127.0.0.1:8787:8787` — loopback
  no host, mas exposto na rede do container (aceitável; padrão do `docker/` e `kong/`).

## Alternativas consideradas

- **Headroom best-effort** (abre o client mesmo sem Headroom) — descartado: o dono
  escolheu "obrigatório — sem Headroom, sem client".
- **Provider com API key própria** (Anthropic/OpenAI direto via Headroom, big-pickle
  sai) — não foi preciso: o spike mostrou que o Zen roteia pelo Headroom via
  `OPENAI_TARGET_API_URL`.
- **Extensão VS Code/Cursor própria** pra abrir o terminal — descartado: `tasks.json`
  com `runOn: folderOpen` faz o mesmo sem nada a publicar/assinar.
- **Interface NIO própria agora** — foi adiada pra Fase 2 (feita depois, em Ink —
  ver `ARQUITETURA-CLIENTE-TUI.md` / ADR 0008): reimplementar o front do OpenCode
  arriscava travar a Fase 1.

## Referências

- `headroom/docker-compose.yml`, `src/lib/headroom.ts`, `src/app/ai-client.ts`,
  `src/lib/ide-tasks.ts`, `src/cli/commands/ai.ts`.
- `src/lib/clients/client-configs.ts` — `planOpencodeProvider` / `planOpencodeUpdate(…, headroomUrl)`.
- `docs/arch/ARQUITETURA-CLIENTES-MULTI-FUTURO.md` (Parte B), `docs/arch/ARQUITETURA-CLIENTE-TUI.md` (Fase 2).
- [ADR 0004](0004-operador-ia-unico.md) (operador único), [ADR 0005](0005-camada-docker.md) (camada Docker).
- https://github.com/headroomlabs-ai/headroom
