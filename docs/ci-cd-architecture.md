# CI/CD — NIO (arquitetura)

> **Status:** PROPOSTA / blueprint (2026-09-03). Decisões travadas:
> **host Linux na LAN · Portainer GitOps · trigger em tags `v*` · imagem GHCR pública**.
> Descreve o fluxo-alvo; a implementação segue a [checklist](#o-que-implementar).
> Depende do stack unificado de [container-architecture.md](container-architecture.md).

## Princípios

1. **Dois planos.** CI (GitHub Actions, nuvem) faz o gate de qualidade e publica a
   imagem. CD (Portainer, no host Linux) materializa o stack.
2. **O GitHub nunca toca prod nem entra na LAN.** Os testes rodam contra um Postgres
   **efêmero** no runner; o deploy é o **Portainer que puxa** (GitOps) — nenhuma porta
   inbound aberta pra internet.
3. **Deploy amarrado ao git.** Toda subida em prod corresponde a uma tag `vX.Y.Z` e a
   um commit no compose de deploy — auditável e reproduzível.
4. **Segredos fora do git.** `NIO_DATABASE_URL`/`JWT_SECRET` vivem como env vars do
   stack no Portainer; o CI usa só o `GITHUB_TOKEN` e a senha do Postgres efêmero.

## Fluxo

```
   ┌── DEV (GitHub Actions, nuvem) ─────────────────────────────────┐
   │  PR / push main ─► ci.yml (GATE)                               │
   │     bun install → tsc --noEmit → bun run build                 │
   │     → Postgres efêmero (aplica db/schema.sql) → bun test       │
   │                                                                │
   │  git tag vX.Y.Z ─┬─► publish.yml   (npm — já existe)           │
   │                  └─► image.yml     (novo)                      │
   │        bun run build → docker build (Dockerfile.gateway)       │
   │        → push GHCR ghcr.io/hugoreiis12-png/nio-gateway         │
   │              tags: vX.Y.Z + latest                            │
   │        → bumpa NIO_GATEWAY_TAG=vX.Y.Z no deploy + commita      │
   └───────────────────────────────┬────────────────────────────────┘
                                    │  Portainer PUXA (outbound, sem exposição)
   ┌── HOST LINUX (LAN) ───────────▼────────────────────────────────┐
   │  Portainer GitOps: observa docker/docker-compose.deploy.yml     │
   │   vê o novo tag → pull da imagem GHCR → redeploy do stack       │
   │                                                                │
   │  stack `nio` (nio-net):                                        │
   │    nio-gateway (imagem GHCR)  ┐                                │
   │    kong  ─ ingresso :8000 (exposto na LAN)                     │
   │    headroom · mcp-gateway · portainer(:9443 LAN)              │
   │    └─► Postgres 192.168.0.142:5432 (mesma LAN)                │
   └──────────────────────────────────────────────────────────────────┘
```

## Plano CI — GitHub Actions

### `ci.yml` — gate (PR + push em `main`)
Roda em `ubuntu-latest`. Passos:
1. `actions/checkout` + `oven-sh/setup-bun` + `setup-node@20`.
2. `bun install --frozen-lockfile`.
3. `tsc --noEmit` (typecheck) + `bun run build`.
4. **Postgres service container** (`postgres:16`, health-gated). Cria o database e
   aplica **`db/schema.sql`** (fonte da verdade / HEAD — já contém todas as migrations).
5. `bun test` com o ambiente apontado pro Postgres efêmero:
   ```
   NIO_DATABASE_URL=postgres://postgres:postgres@localhost:5432/nio_cli
   JWT_SECRET=ci-test-secret
   ```
   Com essas vars, os testes de integração (hoje *gated* em `NIO_DATABASE_URL`/`JWT_SECRET`)
   **rodam de verdade no CI** — e nunca tocam o banco de prod.

> **Ganho colateral:** encerra o risco antigo de a suíte de integração bater no
> Postgres de produção. No CI é sempre descartável.

### `image.yml` — build + push da imagem (tag `v*`)
Roda em `ubuntu-latest`, `permissions: { contents: write, packages: write }`. Passos:
1. checkout + bun + node; `bun install`; **`bun run build`** (gera o `dist/` que o
   `Dockerfile.gateway` copia).
2. `docker/login-action` no **GHCR** com `GITHUB_TOKEN`.
3. `docker/build-push-action`: context `.`, file `Dockerfile.gateway`, push
   `ghcr.io/hugoreiis12-png/nio-gateway` com tags **`${{ github.ref_name }}`** (a tag
   `vX.Y.Z`) e **`latest`**.
4. **Bump determinístico:** grava `NIO_GATEWAY_TAG=vX.Y.Z` no arquivo de valores do
   deploy (ver abaixo) e faz commit `chore(deploy): nio-gateway vX.Y.Z [skip ci]`.
   Esse commit é o gatilho do Portainer GitOps.

### `publish.yml` — npm (já existe)
Mantido. Roda no mesmo trigger `v*`. Opcional: encadear o gate do `ci.yml` como
dependência antes do publish (reuso via `workflow_call`).

## Registro de imagem — GHCR (público)

- **`ghcr.io/hugoreiis12-png/nio-gateway`**, **público** (repo é público → imagem
  pública, zero config de registry no Portainer).
- Só o `nio-gateway` é buildado. headroom/mcp/portainer/kong são imagens públicas já
  **pinadas por digest** no compose (ver container-architecture.md).

## Compose de deploy — `docker/docker-compose.deploy.yml`

Variante de CD, distinta do `docker-compose.yml` (dev). Diferenças:

| Aspecto | dev (`docker-compose.yml`) | deploy (`docker-compose.deploy.yml`) |
|---|---|---|
| gateway | `build: Dockerfile.gateway` | `image: ghcr.io/…/nio-gateway:${NIO_GATEWAY_TAG:-latest}` (sem build) |
| segredos | `env_file: ../.env` | `environment:` lendo `${NIO_DATABASE_URL}`/`${JWT_SECRET}` (env vars do stack no Portainer) |
| Kong | `127.0.0.1:8000:8000` (loopback) | **`8000:8000`** (interface da LAN — clientes remotos batem no Kong) |
| Portainer | `127.0.0.1:9443:9443` | `9443:9443` (UI de gestão acessível na LAN) |
| gateway/headroom/mcp | portas em `127.0.0.1` | por padrão **host-local**; expor na LAN só se os clientes de IA rodarem fora do host |
| headroom/mcp/portainer/kong | idênticos (imagens pinadas) | idênticos |

Notas:
- O gateway fica **atrás do Kong** — clientes remotos usam `http://<host-lan>:8000`
  (rate-limiting aplicado). Expor o gateway `:3000` direto na LAN **burlaria** o
  rate-limit; por isso ele permanece host-local.
- O host Linux precisa alcançar o Postgres `192.168.0.142` (mesma LAN) — nada muda no
  banco.

## Deploy via Portainer GitOps

**Setup 1x (manual, no Portainer do host):**
1. **Stacks → Add stack → Git repository**: aponta pro repo, arquivo
   `docker/docker-compose.deploy.yml`, branch `main`.
2. Habilita **GitOps updates** (polling curto, ex.: 1–5 min, ou webhook se um dia
   quiser).
3. **Environment variables** do stack: `NIO_DATABASE_URL`, `JWT_SECRET`, e
   `NIO_GATEWAY_TAG` (o GitOps sobrescreve pelo arquivo de valores a cada release).
4. Registry: **nenhum** (imagem pública).

**Como o deploy dispara:** o `image.yml` commita o novo `NIO_GATEWAY_TAG` → o Portainer
detecta a mudança no repo → puxa a imagem `:vX.Y.Z` e redeploya o stack. Determinístico
e auditável (cada deploy = 1 commit).

## Segredos — onde cada um vive

| Segredo | CI (GitHub) | Deploy (Portainer) |
|---|---|---|
| push GHCR | `GITHUB_TOKEN` (nativo) | — |
| Postgres de teste | senha do service container (efêmera) | — |
| `NIO_DATABASE_URL` | valor efêmero do job | **env var do stack** |
| `JWT_SECRET` | `ci-test-secret` (throwaway) | **env var do stack** |
| npm | `secrets.NPM_TOKEN` (publish.yml) | — |

Nada de segredo real de prod entra no repo ou nos logs do CI.

## Observabilidade da rede

- **Portainer** (já no stack): topologia da `nio-net` (containers + IPs), health/logs/
  stats por container, status do stack, redeploy 1-clique, histórico de versões do
  GitOps.
- **Opcional — tráfego pelo Kong:** habilitar o plugin **Prometheus** no `kong.yml` +
  um scraper/painel (Grafana) pra métricas de request/latência/erro por rota. Fica pro
  próximo passo se quiser visibilidade de fluxo além do control-plane.

## Fluxo de release (experiência do dev)

1. Abre PR → `ci.yml` roda o gate (typecheck + build + testes com Postgres efêmero).
2. Merge em `main` → `ci.yml` roda de novo no branch.
3. `git tag vX.Y.Z && git push --tags` →
   - `publish.yml` publica no npm,
   - `image.yml` builda+empurra a imagem e commita o novo tag no deploy.
4. Portainer GitOps redeploya o stack com a imagem `vX.Y.Z`. Fim.

## O que implementar

- [ ] `.github/workflows/ci.yml` — gate com Postgres service + `bun test`.
- [ ] `.github/workflows/image.yml` — build/push GHCR + bump do `NIO_GATEWAY_TAG`.
- [ ] `docker/docker-compose.deploy.yml` — imagem GHCR + segredos por env + Kong na LAN.
- [ ] Arquivo de valores do tag (ex.: `docker/deploy.env` com `NIO_GATEWAY_TAG=`) que o
      `image.yml` bumpa e o Portainer lê.
- [ ] (opcional) encadear o gate no `publish.yml`.
- [ ] Setup 1x no Portainer (stack via Git + env vars) — manual, guiado por este doc.

## Decisões registradas

| Decisão | Escolha |
|---|---|
| Alvo de deploy | Host **Linux na LAN** (Docker + Portainer) |
| Mecanismo de CD | **Portainer GitOps** (puxa o repo; nada exposto inbound) |
| Trigger de deploy | Tags **`v*`** (alinhado ao `publish.yml`) |
| Registro de imagem | **GHCR público** (`ghcr.io/hugoreiis12-png/nio-gateway`) |
| Exposição no host | **Kong `:8000` + Portainer `:9443` na LAN**; gateway/headroom/mcp host-local |
| Determinismo | CI **commita o tag** no deploy → GitOps redeploya a versão exata |
| Banco no CI | **Postgres efêmero** (schema.sql) — nunca o prod |
