---
id: "0005"
title: Camada Docker (nio docker) — MCP Gateway + Portainer + Swarm
status: accepted
created: 2026-08-29
---

# Camada Docker (`nio docker`) — MCP Gateway + Portainer + Swarm

## Contexto

`NIO-CLI-Transicao-v1-v2.md` já listava Docker como toolchain de ambiente, mas a
CLI nunca gerenciou container nenhum — o único precedente é o `kong/docker-compose.yml`,
que o dev sobe à mão (`bun run dev:kong`) e a CLI só conhece por uma URL.

O dono do projeto quer uma **camada Docker de verdade**: um grupo `nio docker *`
que sobe/derruba containers, orquestra via compose, debuga erros e faz
clusterização — e que o **operador de IA** (OpenCode/`big-pickle`) consiga dirigir
por linguagem natural.

## Decisão

Uma camada híbrida:

- **Determinístico (wrapper `docker`):** `nio docker toolkit` (infra),
  `nio docker compose`, `nio docker create`, `nio docker portainer`. Wrappers
  finos sobre `docker`/`docker compose` via `spawnSync` **sem shell**.
- **Operador de IA:** `nio docker debug` / `orquest` / `cluster` montam um prompt
  e chamam `opencode run --model opencode/big-pickle "<prompt>"` (headless,
  streamado). O operador usa as **tools do Docker MCP Gateway**.
- **MCP Gateway = container NIO-gerenciado:** `docker/docker-compose.yml` (espelha
  o `kong/`), `image: docker/mcp-gateway`, transport `streaming` em
  `127.0.0.1:8811/mcp`, habilitando o server `docker` do catálogo. `nio docker
  toolkit up` registra `mcp.docker = { type: 'remote', url }` no `opencode.json`
  (opt-in — não entra no `nio init`).
- **`cluster` usa Docker Swarm:** `docker swarm init` + `docker stack deploy -c
  <compose gerado pelo operador> nio-cluster`. A NIO **valida** contra `docker
  stack services` (não confia na saída do operador) e persiste o estado em
  `sessions.config.extra.docker.cluster` (sem migration).
- **Portainer CE** no mesmo compose, pra visibilidade. Host único = manager vê a
  stack direto pelo `docker.sock`.

O contrato dos gateways de IO ("nunca lança", falha → `status`) é seguido pelo
`DockerGateway` (`src/core/docker.ts` + `src/adapters/docker/`).

## Consequências

**Positivas:**
- Reusa todo o padrão do repo: compose como o `kong/`, `McpSpec`/`opencode.json`
  como os outros MCPs, `spawnSync` sem shell como `toolchain-gateway`, prompt +
  spawn como `exec-delegate`, `config.extra` como a recipe.
- Roda em qualquer Docker Engine — **não exige Docker Desktop** (a UI da MCP
  Toolkit é Desktop-only; o Gateway não).
- O operador ganha capacidade real de infra sem a NIO reimplementar orquestração.

**Negativas / trade-offs:**
- **Reabre a gerência de infra-container pela CLI** — antes o Kong era "está lá ou
  não". Agora `nio docker toolkit` tem ciclo de vida (up/down). Aceito: é o pedido.
- Depende de `docker` no PATH; `cluster` depende de Swarm (`docker swarm init`,
  host único no v1). Degrada com erro acionável se faltar.
- Bootstrap do admin do Portainer é manual (1º acesso). Documentado.
- O lock de modelo do operador continua soft (herança da ADR 0004).

## Alternativas consideradas

- **Camada NIO própria** (gerar compose, chamar Swarm API via `dockerode`, IA
  opcional) — descartado: mais código, menos alavancagem do Docker MCP Toolkit
  que o dono pediu explicitamente.
- **`docker mcp` CLI do usuário** em vez de container NIO-gerenciado — descartado:
  o dono escolheu container gerenciado (consistência com o padrão Kong).
- **`cluster` via Compose multi-serviço** em vez de Swarm — descartado: o dono
  pediu "métodos do docker swarm" explicitamente.

## Referências

- `docs/arch/ARQUITETURA-DOCKER.md` — desenho detalhado.
- `docker/docker-compose.yml`, `src/lib/docker.ts`, `src/core/docker.ts`,
  `src/adapters/docker/`, `src/app/docker-manager.ts`, `src/cli/commands/docker.ts`.
- `docs/arch/ARQUITETURA-GATEWAY.md` — nota "MCP Gateway ≠ AI Gateway".
- https://github.com/docker/mcp-gateway · https://docs.docker.com/ai/mcp-catalog-and-toolkit/
