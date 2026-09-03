# Arquitetura de Containers — NIO

> **Status:** PROPOSTA / arquitetura-alvo (2026-09-02). Descreve o modelo ideal de
> gerenciamento de containers + camada L7, **não** o estado atual (hoje são 3
> composes separados em redes isoladas — ver [Estado atual vs. alvo](#estado-atual-vs-alvo)).
> A adoção segue a [checklist de migração](#migração-3-composes--1-stack).

## Objetivo

Um **stack único**, gerenciável de forma limpa no **Portainer**, com o **Kong como
camada L7** (ingresso único + roteamento por path + rate-limiting + balanceamento
horizontal). Princípios:

1. **Um compose, um stack** — bring-up com um comando, uma entrada no Portainer.
2. **Uma rede** (`nio-net`) — os serviços se resolvem por **nome** (DNS do Docker);
   o Kong alcança `nio-gateway:3000`, `headroom:8787`, etc.
3. **Ingresso único pelo Kong** (`:8000`) — os backends **não** ficam expostos no
   host (só via Kong); portas diretas só num profile `debug` opcional.
4. **Plano de gestão separado** — o Portainer (`:9443`) é o painel, fora do caminho
   de dados do Kong.
5. **Segredos fora do git** — `JWT_SECRET`/`NIO_DATABASE_URL` via `env_file`
   (`.env`, gitignored) ou variáveis do stack no Portainer.
6. **Saúde e ordem** — `healthcheck` em cada serviço + `depends_on: service_healthy`;
   o Kong sobe por último.

## Topologia

```
                         HOST
   ┌────────────────────────────────────────────────────────────┐
   │  :8000  Kong (ingresso L7)          :9443  Portainer (UI)   │
   └────┬───────────────────────────────────────┬───────────────┘
        │                                        │ (gerencia o stack via docker.sock)
        │  rede  nio-net (bridge, DNS por nome)  │
   ┌────┴────────────────────────────────────────┴───────────────┐
   │                                                              │
   │  Kong  ─┬─ /login /logout /verify-2fa /security /health ─►  nio-gateway:3000
   │         │        (rate-limit em login/verify-2fa/security)   │        │
   │         ├─ /v1  ───────────────────────────────────────►  headroom:8787
   │         └─ /mcp ───────────────────────────────────────►  mcp-gateway:8811
   │                                                              │
   │  nio-gateway ──► Postgres (192.168.0.142:5432, remoto/LAN)   │
   │  mcp-gateway ──► /var/run/docker.sock                        │
   └──────────────────────────────────────────────────────────────┘
```

> O `nio-gateway` deixa de ser processo solto no host e vira **container** no stack
> — assim entra no Portainer e no roteamento por nome do Kong. Ele fala com o
> Postgres remoto por env (LAN), nada muda no lado do banco.

## Serviços e imagens

| Serviço       | Imagem (pinar!)        
                | Porta interna | Exposição no host | Papel |
|---------------|----------------------------------------|---------------|-------------------|-------|
| `kong`        | `kong:3.9`                             | 8000 / 8001   | `8000` (proxy)    | Ingresso L7 / LB / rate-limit |
| `nio-gateway` | build local (`Dockerfile.gateway`)     | 3000          | — (só via Kong)   | Auth: login, 2FA, security |
| `headroom`    | `ghcr.io/headroomlabs-ai/headroom:<pin>` | 8787        | — (só via Kong)   | Proxy de compressão p/ o cliente de IA |
| `mcp-gateway` | `docker/mcp-gateway:<pin>`             | 8811          | — (só via Kong)   | Tools MCP `docker` |
| `portainer`   | `portainer/portainer-ce:<pin>`         | 9443 (HTTPS)  | `9443`            | Gestão visual do stack |

> **Pinar versões exatas** (não `:latest`) — reprodutibilidade e imunidade a breaking
> changes silenciosos.
>
> **Resolvendo a colisão de `:8000`:** hoje o Portainer mapeia `8000:8000` (túnel do
> Edge Agent, **inútil localmente**) e colide com o Kong. No alvo, **removemos** o
> `8000` do Portainer — o Kong passa a ser o dono legítimo de `:8000`.

## Rede

Uma bridge dedicada `nio-net`. Todos os serviços nela → DNS interno do Docker resolve
`headroom`, `nio-gateway`, `mcp-gateway` por nome. É o que permite o `kong.yml` apontar
para `http://nio-gateway:3000` (em vez do frágil `host.docker.internal`).

```yaml
networks:
  nio-net:
    name: nio-net
    driver: bridge
```

## Kong — roteamento L7 + rate-limiting

DB-less (declarativo, recarrega no restart). O `kong.yml` **preserva** as rotas de
segurança atuais (2FA/security/logout/health) e **adiciona** os backends de dados.
Cada `service.url` usa o **nome do serviço** na `nio-net`.

```yaml
_format_version: "3.0"

services:
  # ── Auth (nio-gateway) ─────────────────────────────────────────────
  - name: nio-gateway
    url: http://nio-gateway:3000
    routes:
      - name: gw-login
        paths: ["/login"]
        strip_path: false
        plugins:
          - name: rate-limiting
            config: { minute: 20, policy: local }
      - name: gw-verify-2fa
        paths: ["/verify-2fa"]
        strip_path: false
        plugins:
          - name: rate-limiting
            config: { minute: 10, policy: local }
      - name: gw-security
        paths: ["/security"]
        strip_path: false
        plugins:
          - name: rate-limiting
            config: { minute: 10, policy: local }
      - name: gw-logout
        paths: ["/logout"]
        strip_path: false
      - name: gw-health
        paths: ["/health"]
        strip_path: false

  # ── Dados ──────────────────────────────────────────────────────────
  - name: headroom
    url: http://headroom:8787
    routes:
      - name: headroom-v1
        paths: ["/v1"]          # API OpenAI-compatível (/v1/chat/completions, …)
        strip_path: false
  - name: mcp-gateway
    url: http://mcp-gateway:8811
    routes:
      - name: mcp
        paths: ["/mcp"]
        strip_path: false
```

> **Sem colisão de path:** `/login`, `/v1`, `/mcp`, `/security`… são disjuntos.
> O Portainer **não** entra atrás do Kong — o painel de gestão fica direto em `:9443`.

## Balanceamento horizontal (o "L7 LB" de verdade)

Kong sozinho é um **reverse proxy L7**; vira **load balancer** quando há réplicas.
Como o `service.url` aponta para um **nome de serviço** do compose, o DNS embutido do
Docker devolve todos os IPs das réplicas e o Kong faz **ring-balancer** (round-robin)
sobre eles. Para escalar o serviço stateless de auth:

```bash
docker compose -f docker/docker-compose.yml up -d --scale nio-gateway=3
```

O Kong passa a distribuir `/login`, `/verify-2fa`, … entre as 3 réplicas — sem mudar
o `kong.yml`. (Headroom, mcp-gateway e portainer permanecem singletons.)

> Para políticas explícitas (health-aware, pesos, hash por consumidor), promova o
> `headroom`/`nio-gateway` a um `upstreams:` no `kong.yml` com `targets:` — o passo
> seguinte quando quiser controle fino do LB.

## Saúde e ordem de subida

`healthcheck` por serviço + `depends_on: condition: service_healthy` → o Kong só sobe
quando os backends respondem.

```yaml
  nio-gateway:
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://localhost:3000/health || exit 1"]
      interval: 10s
      timeout: 3s
      retries: 5
      start_period: 15s

  kong:
    depends_on:
      nio-gateway: { condition: service_healthy }
      headroom:    { condition: service_healthy }
      mcp-gateway: { condition: service_started }   # imagem sem healthcheck próprio
```

> `headroom` e `kong` já trazem `HEALTHCHECK` embutido nas imagens — reaproveite (não
> precisa redefinir). Para `nio-gateway`, o healthcheck acima exige `curl` na imagem
> (incluído no `Dockerfile.gateway`). Para `mcp-gateway` (sem healthcheck oficial),
> use `service_started` ou um TCP-check no `:8811`.

## Portas no host

| Host  | Serviço      | Uso                          | Exposto? |
|-------|--------------|------------------------------|----------|
| 8000  | kong         | **Ingresso L7 único**        | ✓        |
| 9443  | portainer    | UI de gestão                 | ✓        |
| 8001  | kong (admin) | Admin API (bind `127.0.0.1`) | local    |
| 3000  | nio-gateway  | interno — só via Kong        | ✗        |
| 8787  | headroom     | interno — só via Kong        | ✗        |
| 8811  | mcp-gateway  | interno — só via Kong        | ✗        |

**Profile `debug` (opcional):** para bater direto num backend sem passar pelo Kong,
exponha as portas sob `profiles: ["debug"]` e suba com
`docker compose --profile debug up -d`. No modo normal, o único caminho de dados é o
Kong.

## Segredos e configuração

O `nio-gateway` (container) precisa de `NIO_DATABASE_URL` e `JWT_SECRET`. **Nunca**
commitados: via `env_file` (o `.env`, gitignored) ou variáveis do stack no Portainer.

```yaml
  nio-gateway:
    env_file: [ .env ]          # NIO_DATABASE_URL, JWT_SECRET (gitignored)
    environment:
      GATEWAY_HOST: 0.0.0.0     # ouvir em toda a rede do container
      GATEWAY_PORT: "3000"
```

> `NIO_DATABASE_URL` apontando para `192.168.0.142:5432` funciona de dentro do
> container (a bridge tem saída pra LAN). Em produção, prefira definir os segredos
> como **variáveis do stack no Portainer**, não em arquivo.

## Volumes e persistência

- **Kong:** `kong.yml` montado read-only em `/kong/kong.yml`.
- **Portainer:** `/var/run/docker.sock` + volume `nio_portainer_data`.
- **mcp-gateway:** `/var/run/docker.sock` (precisa falar com o engine).
- **headroom:** volume `nio_headroom_cache` (cache do proxy).
- **nio-gateway:** sem volume (stateless; estado vive no Postgres).

## Gestão no Portainer

Como tudo é **um compose = um stack**, o Portainer o mostra como **uma stack única**
(`nio`), não containers soltos:

- **Deploy/gerência pela UI:** Stacks → *Add stack* → *Web editor* (cola o compose) ou
  *Repository* (aponta pro repo). Redeploy, logs, escala e env por lá.
- **Ou por CLI** (o Portainer continua enxergando, pois observa o mesmo engine):
  `docker compose -f docker/docker-compose.yml up -d`.
- **Regra:** escolha **um** dono do YAML (Portainer *ou* CLI) para os mesmos serviços,
  pra não duplicar stacks.

## `docker/docker-compose.yml` (alvo)

```yaml
name: nio

networks:
  nio-net: { name: nio-net, driver: bridge }

volumes:
  nio_portainer_data: { name: nio_portainer_data }
  nio_headroom_cache: { name: nio_headroom_cache }

services:
  nio-gateway:
    build: { context: ., dockerfile: Dockerfile.gateway }
    image: nio-gateway:local
    container_name: nio-gateway
    restart: unless-stopped
    env_file: [ .env ]
    environment:
      GATEWAY_HOST: 0.0.0.0
      GATEWAY_PORT: "3000"
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://localhost:3000/health || exit 1"]
      interval: 10s
      timeout: 3s
      retries: 5
      start_period: 15s
    networks: [ nio-net ]
    profiles: []            # sempre sobe
    # porta 3000 NÃO exposta (só via Kong); use --profile debug p/ expor
    ports: !reset []

  headroom:
    image: ghcr.io/headroomlabs-ai/headroom:latest   # PINAR
    container_name: nio-headroom
    restart: unless-stopped
    command: ["--host", "0.0.0.0", "--port", "8787"]
    environment:
      OPENAI_TARGET_API_URL: "${NIO_HEADROOM_OPENAI_TARGET:-https://opencode.ai/zen/v1}"
      HEADROOM_UPDATE_CHECK: "off"
    volumes: [ "nio_headroom_cache:/root/.headroom" ]
    networks: [ nio-net ]

  mcp-gateway:
    image: docker/mcp-gateway:latest                 # PINAR
    container_name: nio-mcp-gateway
    restart: unless-stopped
    command: ["--transport=streaming", "--port=8811", "--servers=docker"]
    volumes: [ "/var/run/docker.sock:/var/run/docker.sock" ]
    networks: [ nio-net ]

  portainer:
    image: portainer/portainer-ce:lts                # PINAR
    container_name: nio-portainer
    restart: unless-stopped
    volumes:
      - "/var/run/docker.sock:/var/run/docker.sock"
      - "nio_portainer_data:/data"
    ports:
      - "127.0.0.1:9443:9443"      # UI (edge :8000 REMOVIDO — libera :8000 p/ Kong)
    networks: [ nio-net ]

  kong:
    image: kong:3.9
    container_name: nio-kong
    restart: unless-stopped
    environment:
      KONG_DATABASE: "off"
      KONG_DECLARATIVE_CONFIG: /kong/kong.yml
      KONG_PROXY_LISTEN: "0.0.0.0:8000"
      KONG_ADMIN_LISTEN: "0.0.0.0:8001"
    volumes: [ "./kong.yml:/kong/kong.yml:ro" ]
    ports:
      - "127.0.0.1:${NIO_KONG_PROXY_PORT:-8000}:8000"
      - "127.0.0.1:${NIO_KONG_ADMIN_PORT:-8001}:8001"
    depends_on:
      nio-gateway: { condition: service_healthy }
      headroom:    { condition: service_healthy }
      mcp-gateway: { condition: service_started }
    networks: [ nio-net ]

# Profile debug: expõe backends direto no host (bypass do Kong) p/ diagnóstico.
# docker compose --profile debug up -d
```

> Notas: o `ports: !reset []` ilustra a intenção (não expor) — na prática, basta
> **omitir** o bloco `ports` do backend e adicionar um serviço/override sob
> `profiles: ["debug"]` que exponha `8787`/`8811`/`3000` quando necessário.

## `Dockerfile.gateway`

```dockerfile
FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
# dist já buildado (tsc) — copiamos o artefato, sem devDeps de build
COPY dist ./dist
RUN npm ci --omit=dev --no-audit --no-fund
EXPOSE 3000
CMD ["node", "dist/gateway/index.js"]
```

## Migração (3 composes → 1 stack)

1. **Unificar** os serviços de `kong/`, `headroom/` e `docker/` num só
   `docker/docker-compose.yml` (o modelo acima).
2. **Rede** `nio-net` em todos.
3. **Containerizar o gateway**: `Dockerfile.gateway` + serviço `nio-gateway` com
   `env_file`.
4. **`kong.yml`**: trocar `host.docker.internal:3000` por `nio-gateway:3000` e
   **adicionar** as rotas `/v1` (headroom) e `/mcp` (mcp-gateway), **preservando**
   `/verify-2fa`, `/security`, `/logout`, `/health` e o rate-limiting.
5. **Portainer:** remover o mapeamento `8000:8000` (libera a porta pro Kong).
6. **Healthchecks + `depends_on`** (Kong por último).
7. **Pinar** todas as imagens.
8. **Apontar a CLI pro ingresso do Kong** (ver abaixo).
9. **Remover** `kong/docker-compose.yml` e `headroom/docker-compose.yml`.
10. **Testes:** `bun test` (`src/lib/headroom.test.ts`,
    `src/adapters/docker/docker-gateway.test.ts`) + smoke dos endpoints via `:8000`.

## Mudanças na CLI

Com o ingresso único no Kong, os clientes deixam de bater nas portas diretas:

| Arquivo / config          | O que muda |
|---------------------------|------------|
| `src/lib/docker.ts`       | `infraComposePath()` → já aponta pra `docker/docker-compose.yml` (o stack unificado); manter. |
| `src/lib/headroom.ts`     | `headroomComposePath()` → **remover** (Headroom passa a viver no compose unificado); `HEADROOM_URL` default → `http://127.0.0.1:8000/v1`. |
| `NIO_GATEWAY_URL`         | `http://127.0.0.1:8000` (CLI fala com o gateway **via Kong**, não `:3000`). |
| `NIO_HEADROOM_URL`        | `http://127.0.0.1:8000/v1` (provider do OpenCode). |
| `opencode.json` (MCP)     | url do `docker` MCP → `http://127.0.0.1:8000/mcp` (via Kong) ou mantém `:8811` no profile debug. |
| `src/cli/commands/docker.ts` | `headroomUp/Down` e `toolkitUp/Down` → operar o **stack único** (um `up -d`/`down`). |

## Estado atual vs. alvo

| Aspecto            | Hoje (real)                                   | Alvo (este doc) |
|--------------------|-----------------------------------------------|-----------------|
| Composes           | 3 (`docker/`, `kong/`, `headroom/`)           | 1 (`docker/docker-compose.yml`) |
| Redes              | 3 isoladas (`kong_default`, `headroom_default`, `docker_default`) | 1 (`nio-net`) |
| Resolução do Kong  | `host.docker.internal:3000` (só o gateway)    | por nome: `nio-gateway`, `headroom`, `mcp-gateway` |
| Gateway            | processo host (node, `:3000`)                 | container no stack |
| Kong               | só protege o gateway; roda em `:8010` (evita colisão) | ingresso L7 de tudo em `:8000` (Portainer libera a porta) |
| Healthcheck/ordem  | nenhum no compose (só HEALTHCHECK de imagem)  | healthcheck + `depends_on` explícitos |
| Portainer          | vê os 3 stacks separados                      | um stack `nio` único |
| Imagens            | `:latest`                                     | pinadas |
