# Arquitetura — Camada Docker (`nio docker *`)

> Documento de referência. A NIO-CLI ganha um grupo `nio docker` que faz
> operações determinísticas de container/compose (wrapper fino sobre `docker`) e
> delega debug/orquestração/cluster pro **operador de IA** (OpenCode/`big-pickle`)
> por linguagem natural, via as tools do **Docker MCP Gateway**. Visibilidade via
> **Portainer**. Decisão formal: [ADR 0005](../adr/0005-camada-docker.md).

## Resumo executivo

```
                         nio docker …
        ┌────────────────────┴────────────────────┐
   determinístico                            operador de IA
   (wrapper `docker`)                        (opencode run + tools MCP)
   ┌─────────────┐                           ┌──────────────────────┐
   │ compose     │  docker compose …         │ debug   → analisa    │
   │ create      │  docker run …             │ orquest → gera compose│
   │ toolkit up  │  sobe a infra + registra  │ cluster → Swarm stack │
   │ portainer   │  abre a UI                │   (NIO persiste+valida)│
   └─────────────┘                           └──────────┬───────────┘
                                                        │ tools
                              ┌─────────────────────────▼───────────────┐
                              │ docker/docker-compose.yml  (127.0.0.1)  │
                              │  nio-mcp-gateway  :8811/mcp  (streaming) │
                              │   └─ server `docker` (docker/compose/swarm as tools)
                              │  nio-portainer    :9443 / :8000          │
                              └─────────────────────────┬───────────────┘
                                              /var/run/docker.sock
```

## Componentes

### `docker/docker-compose.yml` — infra NIO
Espelha `kong/docker-compose.yml` (portas pinadas em `127.0.0.1`,
`restart: unless-stopped`, `extra_hosts` p/ Linux). **Roda em qualquer Docker
Engine — não exige Docker Desktop.**

- **`mcp-gateway`** (`docker/mcp-gateway`) — o [Docker MCP Gateway](https://github.com/docker/mcp-gateway),
  transport `streaming` em `127.0.0.1:8811/mcp`, habilitando o server `docker` do
  catálogo (docker/compose/swarm como tools MCP). Monta `/var/run/docker.sock`.
- **`portainer`** (`portainer/portainer-ce:lts`) — UI de gerência. 1º acesso pede
  setup de admin (feito à mão no navegador).

Sobe com `nio docker toolkit up` (ou `bun run dev:docker`).

### Registro no `opencode.json`
`nio docker toolkit up` chama `upsertOpencodeMcp(dockerGatewayMcp)`
(`src/lib/client-configs.ts`) — funde **uma** entrada `mcp.docker = { type:
'remote', url: 'http://127.0.0.1:8811/mcp', enabled: true }` no
`~/.config/opencode/opencode.json`, com `.bak`, preservando o resto. `toolkit
down` volta `enabled: false`. **Não** entra no `BASE_MCPS` do `nio init` — é
opt-in (quem não usa Docker não carrega um MCP morto). `McpSpec` ganhou `url?`
pra suportar MCP remoto (era só `command` = local).

### `src/lib/docker.ts` — config/health
`DOCKER_MCP_PORT`/`DOCKER_MCP_URL` (`NIO_DOCKER_MCP_*`, 8811), `PORTAINER_PORT`/
`PORTAINER_URL` (9443), `CLUSTER_STACK` (`nio-cluster`), `infraComposePath()`,
`dockerAvailable()` (`docker` + `docker compose version`), `swarmActive()`,
`portOpen()` (checagem TCP pura — o Portainer é TLS self-signed), `unreachableDocker()`.

### `src/core/docker.ts` + `src/adapters/docker/docker-gateway.ts` — port + adapter
`DockerGateway` — contrato **nunca lança** (igual ao `ToolchainGateway`/
`IdeGateway`): falha vira `DockerResult { status: 'ok'|'unavailable'|'failed' }`.
O adapter roda `spawnSync('docker', [...args])` **sem shell** (args em array,
zero interpolação do usuário). Arg-builders puros (`composeArgs`, `runArgs`,
`stackDeployArgs`, `serviceScaleArgs`) testados isolados.

### `src/app/docker-manager.ts` — o lado inteligente
Só `debug`/`orquest`/`cluster` passam por aqui. Monta o prompt (preâmbulo âncora,
como `exec-delegate.buildPrompt`) e chama `runOperator(prompt)` →
`spawn('opencode', ['run','--model','opencode/big-pickle', prompt], { stdio:
'inherit' })` — o usuário acompanha ao vivo, o operador usa as tools Docker.
Estado de cluster em `sessions.config.extra.docker.cluster` (sem migration —
mesmo padrão do `config.extra.recipe`).

## Comandos

| Comando | Tipo | O que faz |
|---|---|---|
| `nio docker toolkit up\|down\|status` | det. | infra `docker/docker-compose.yml` + registro no opencode.json |
| `nio docker portainer [--url]` | det. | abre `https://127.0.0.1:9443` |
| `nio docker compose <up\|down\|restart\|ps\|logs> [svc]` | det. | wrapper sobre `docker compose` do projeto (`-f`, `-d/--no-detach`, `--build`, `--tail`) |
| `nio docker create` | det. | wizard (imagem/nome/portas/env/volumes) → `docker run` (ou flags `--image` etc.) |
| `nio docker debug [container]` | IA | coleta `ps -a`/`logs`/`inspect` → operador analisa e propõe/aplica o fix (`--json` = só o contexto) |
| `nio docker orquest [instrução]` | IA | NL → operador gera/atualiza o `docker-compose.yml` do projeto e sobe (`--dry-run` = só mostra) |
| `nio docker cluster up\|down\|status\|scale` | IA + det. | Swarm: `up` = `swarm init` + operador monta o stack + `stack deploy nio-cluster`; a NIO **valida** contra `docker stack services` e persiste; `scale <svc>=<n>` e `status` são determinísticos |

Guards: `debug`/`orquest`/`cluster` exigem `nio login` + sessão ativa + `opencode`
no PATH. Todos checam `dockerAvailable()` antes de agir.

## Cluster (Docker Swarm)

`nio docker cluster up "api + worker + redis"`:
1. `docker swarm init` (idempotente — no-op se já ativo).
2. Operador monta um compose de stack (v3.x, com `deploy:` — replicas,
   restart_policy) e roda `docker stack deploy -c <arquivo> nio-cluster`.
3. A NIO **não confia na saída do operador**: roda `docker stack services
   nio-cluster --format '{{.Name}}\t{{.Replicas}}'`, extrai os serviços reais e
   persiste `{ stack, services, deployedAt }` em `config.extra.docker.cluster`.
4. `nio docker cluster status` compara o vivo com o persistido.

Portainer (host único = manager) enxerga a stack direto via `docker.sock`. Swarm
multi-nó exigiria o **Portainer Agent** como serviço global — documentado, fora
do escopo v1.

## Não é AI Gateway

O Docker MCP Gateway carrega tráfego de **tool MCP** (operador → `docker.sock`),
**não** chamadas de LLM. A camada que carrega LLM é o **Headroom**
([ADR 0007](../adr/0007-headroom-proxy-obrigatorio.md)) — outro container
NIO-gerenciado (`headroom/docker-compose.yml`), proxy de compressão obrigatório
pro `nio ai`.

## Débito / fora de escopo

- Bootstrap headless do admin do Portainer — 1º acesso é manual (setter token).
- Portainer Agent (Swarm multi-nó).
- Tabela `docker_events` (histórico de operações) — `config.extra.docker` basta no v1.
- `nio init` oferecer `nio docker toolkit up` — só dica no fim do init.
- Confirmar o nome exato do server do catálogo (`--servers=docker`) e o entrypoint
  da imagem `docker/mcp-gateway` no primeiro uso real.
