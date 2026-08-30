# Arquitetura de Clientes de IA — multi-cliente + Headroom + failover (FUTURO / parkeado)

> ⚠️ **Feature parkeada — ADR [0004](../adr/0004-operador-ia-unico.md) (29 ago 2026).**
> Hoje a NIO-CLI usa um **operador único fixo**: OpenCode + `opencode/big-pickle`
> (ver `ARQUITETURA-CLIENTE-IA.md`). Este documento é o desenho da evolução
> multi-cliente, a ser retomada como projeto próprio.
>
> **A Parte A já foi implementada e revertida** — commit `ffd13c3` (27 ago) a
> entregou; a reversão cirúrgica (29 ago, ADR 0004) tirou-a do fluxo mas deixou o
> motor de config do Codex (`codexTarget`, `toCodexDocs`, `planCodexUpdate`,
> `installCodexGlobal`) **dormente no repo**. Retomar a Parte A = re-plugar, não
> recomeçar; o diff de `ffd13c3` é o guia.
>
> Origem: `~/.claude/plans/cryptic-cooking-mitten.md` (plano de 27 ago).

## Visão

Evoluir o operador de IA da CLI em 3 partes:

1. **Dois clientes primários** — OpenCode (big-pickle) **e** Codex. `nio init`
   detecta qual está instalado no host e sobe o que existir como principal.
2. **Headroom** (`github.com/headroomlabs-ai/headroom`, Apache 2.0) — camada de
   compressão de contexto ("economizador de token"), integrada como **proxy em
   Docker** (mesmo formato do Kong).
3. **Ladder de agentes com failover** — quando o agente ativo esgota o token/quota,
   entra um **container Docker** com um segundo agente (Qwen3.8-Flash via
   DashScope), depois um terceiro (Kimi-K2.7-Code via Moonshot). Ordem fixa
   1º → 2º → 3º. O 1º precisa estar instalado no host; o 2º e 3º sobem via
   container e assumem a orquestração da CLI quando necessário.

### Decisões do dono (27 ago 2026)

- **Faseado — Parte A primeiro.** B e C ficam em alto nível.
- **Headroom = proxy em Docker** (igual ao Kong).
- **Containers de fallback = OpenCode-in-container**, só trocando provider/modelo.
- **Detecção de esgotamento = pattern na saída + `nio agent next` manual.**

### Riscos / reversões a registrar

- **Reverte uma decisão documentada.** `ARQUITETURA-GATEWAY.md` rejeitou o Kong AI
  Gateway porque *"nenhum tráfego de LLM passa pela NIO-CLI — a chamada do modelo
  acontece dentro dos processos que ela spawna"*. Headroom-como-proxy reabre isso
  de propósito. **Atualizar aquele doc quando a Parte B for feita.**
- **TTY vs. scan de saída.** Agentes interativos (opencode/codex) usam TUI em
  raw-mode. Não dá pra ler o stream deles sem um PTY (`node-pty`, dep nativa) ou
  quebrar a UI. **MVP da Parte C**: `nio agent next` manual + heurística de
  exit-code. Scan automático = enhancement posterior com `node-pty`.
- **Headroom + tier-1 de assinatura.** Não verificado se o Headroom consegue
  proxiar OpenCode Zen (big-pickle) / Codex-assinatura. É **limpo** nos tiers
  pagos (Qwen/Kimi). Tier-1 via Headroom = spike da Parte B.
- **Custo.** Tiers 2/3 são pay-per-token (DashScope ~$2/$6, Moonshot ~$0.95/$4 por
  M). O failover mantém o trabalho rodando **pagando por token** quando o primário
  (flat-rate) esgota. Headroom mitiga.
- **Docker vira requisito** dos tiers 2/3 (degradação graciosa se ausente).
- **Churn de modelo.** "Qwen3.8-Flash"/"Kimi-K2.7-Code" mudam. Config dos tiers
  fica em `~/.nio/agent-tiers.json` (defaults embutidos, editável sem release).

---

## PARTE A — Detecção de cliente primário (OpenCode | Codex) — DETALHADA

**Objetivo:** `nio init` detecta qual dos dois está no PATH; o que existir vira o
principal (config escrita + handoff no fim). Ambos → OpenCode por prioridade, com
prompt de escolha e override.

> Implementada em `ffd13c3`, revertida na ADR 0004. Os passos abaixo descrevem o
> que foi feito — ao retomar, o diff de `ffd13c3` é a referência exata.

### A1 — Reativar o Codex no registro de clientes

`src/lib/client-install.ts`: adicionar `codex` a `CLIENTS`:
```ts
codex: { id: 'codex', label: 'Codex CLI', binary: 'codex', npm: '@openai/codex', url: 'https://developers.openai.com/codex/cli' }
```
`exec-engines.ts` já tem o engine `codex` com bin `codex` — reusar a resolução de
bin de lá se útil.

### A2 — Detecção do primário (`src/lib/primary-client.ts`)

```ts
export type PrimaryClient = 'opencode' | 'codex';
export const PRIMARY_PRIORITY: PrimaryClient[] = ['opencode', 'codex']; // OpenCode vence (linhagem big-pickle)
export interface PrimaryDetection { chosen: PrimaryClient | null; installed: PrimaryClient[]; }
/** Detecta pelo PATH (`isBinaryInstalled`, injetável); override NIO_PRIMARY_CLIENT (só vale se o binário existir). */
export function detectPrimaryClient(hint?, isInstalled = isBinaryInstalled): PrimaryDetection
```
Reusa `isBinaryInstalled` (`src/lib/client-install.ts`) e `env('PRIMARY_CLIENT')`.

### A3 — `nio init` usa o primário detectado

- **`src/cli/flows/clients.ts`**: `ensureCoreClients` → `resolvePrimaryClient()` —
  roda `detectPrimaryClient()`. Nenhum instalado → oferece instalar OpenCode
  (default) ou Codex. Um só → confirma. Ambos → `select` "qual usar?" e persiste
  em `nio.user.json`.
- **`src/cli/commands/init/clients-step.ts`**: sai o checkbox de 1 opção; entra
  `installPrimaryClient(primary, profileMcps)` → `installOpencodeGlobal` **ou**
  `installCodexGlobal`.
- **`src/lib/client-configs.ts`**: `planCodexUpdate` ganha `profileMcps: McpSpec[]`
  (paridade com `planOpencodeUpdate`); cada spec vira `mcp_servers.<id>` no
  `config.toml`. + `codexMcpEntry`, `codexGlobalPath`.
- **`src/cli/commands/init/index.ts`**: `resolveProvisionTargets(primary)` →
  `targetForPrimary(primary)` (`opencodeTarget` **ou** `codexTarget` — `toCodexDocs`
  já traduz); `handoffToOperator(primary)` spawna o binário do primário.
- **`src/lib/targets.ts`**: `ALL_TARGETS` dinâmico; `targetForPrimary()`;
  `detectConfiguredTargets` checa `~/.codex/config.toml` também.

### A4 — Persistência do primário (per-máquina)

O primário é fato **da máquina** (depende do que está instalado nela), não da
`Session` (Postgres, retomável em outra máquina). `nio.user.json`
(`UserConfig.primaryClient?`) guarda só um **hint** — `nio init` sempre re-detecta.
**Não** gravar em `sessions.config`.

### A5 — `nio agent` (comando, base pra Parte C)

`src/cli/commands/agent.ts` — `nio agent status` (default) mostra primário
detectado, instalados, hint, override. Placeholder pros subcomandos `next` /
`reset` / `tiers` da Parte C.

### A — Arquivos

**Novos:** `src/lib/primary-client.ts` (+ teste), `src/cli/commands/agent.ts`.
**Editar:** `src/lib/client-install.ts`, `src/lib/client-configs.ts`,
`src/lib/targets.ts`, `src/lib/autopull.ts`, `src/cli/flows/clients.ts`,
`src/cli/commands/init/clients-step.ts`, `src/cli/commands/init/provision-step.ts`,
`src/cli/commands/init/index.ts`, `src/config.ts`, `src/cli.ts`,
`scripts/gen-reference.ts`, `README.md`, `docs/v2/PROGRESSO.md`.
**Reusar:** `isBinaryInstalled`, `ensureClientInstalled`, `installCodexGlobal`,
`codexTarget`/`toCodexDocs`, `planCodexUpdate`, `env()`/`envName()`.

### A — Verificação

```bash
bunx tsc --noEmit && bun test
# unit: detectPrimaryClient (só opencode / só codex / ambos / nenhum / override)
# unit: planCodexUpdate com profileMcps
# smoke: renomear `opencode` do PATH → nio init detecta codex, escreve ~/.codex/config.toml
#        com mcp_servers.nio + mcp_servers.<profile mcps>, provisiona skills traduzidas,
#        handoff spawna `codex`
# smoke: ambos instalados → prompt, escolha gravada em nio.user.json
```

---

## PARTE B — Headroom como proxy Docker — ESBOÇO

- **`headroom/docker-compose.yml`** (espelha `kong/docker-compose.yml`):
  `image: ghcr.io/headroomlabs-ai/headroom:latest`, `command: ["proxy", "--port",
  "8787"]`, `ports: ["127.0.0.1:8787:8787"]`, env `ANTHROPIC_API_KEY` /
  `OPENAI_API_KEY` / `DASHSCOPE_API_KEY` / `MOONSHOT_API_KEY`,
  `HEADROOM_OUTPUT_SHAPER=1`, `HEADROOM_UPDATE_CHECK=off`, volume `headroom_cache`.
  `extra_hosts` p/ Linux.
- **`dev:headroom`** script.
- **`src/lib/headroom.ts`** — `HEADROOM_PORT` (`NIO_HEADROOM_PORT`, default 8787),
  `HEADROOM_URL` (`http://127.0.0.1:8787/v1` no host,
  `http://host.docker.internal:8787/v1` nos containers), `headroomHealthy()`.
- **Wiring**: quando um agente é configurado, o `baseURL` do provider aponta pro
  Headroom. **Código novo** — hoje nada escreve `provider`/`baseURL` no
  `opencode.json` (`planOpencodeUpdate` só mexe em `model`+`mcp`, com `...existing`).
- **Spike**: rotear o tier-1 (big-pickle / codex-assinatura) pelo Headroom. Começar
  pelos tiers pagos (Parte C), onde é limpo.
- **Atualizar `ARQUITETURA-GATEWAY.md`** — a premissa "nenhum LLM pela CLI" muda.

---

## PARTE C — Ladder de agentes + orquestrador com failover — ESBOÇO

- **Registro de tiers** — `src/agents/tiers.ts` (padrão do `exec-engines.ts`
  `SPECS`): tier 1 = `{ kind: 'host', client: <primário> }`; tiers 2+ = `{ kind:
  'container', service, provider, model, apiKeyEnv, quotaErrorPatterns }`. Defaults
  embutidos (`agent-qwen` → Qwen3.8-Flash/DashScope; `agent-kimi` →
  Kimi-K2.7-Code/Moonshot), sobrescrevíveis por `~/.nio/agent-tiers.json`.
- **`agents/Dockerfile` + `agents/docker-compose.yml`** — imagem node + `opencode-ai`,
  `opencode.json` com provider custom (`@ai-sdk/openai-compatible`,
  `options.baseURL` → Headroom → DashScope/Moonshot) + `model`. Serviços
  `agent-qwen`, `agent-kimi`. Handoff: `spawn('docker', ['compose','run','--rm',
  '-it', service], { stdio: 'inherit' })`.
- **`src/app/agent-orchestrator.ts`** — `run()`: escolhe o tier ativo (menor
  não-esgotado / fora de cooldown) → spawna → detecção (primária: `nio agent next`
  manual via arquivo-sinal / SIGUSR2; secundária: exit-code). Ao esgotar: marca
  `{ exhaustedAt, cooldownUntil }` (~4h), avança. Sem tiers → encerra.
- **Estado** — `~/.nio/agent-tiers.json`: `{ tiers: { <id>: { exhaustedAt,
  cooldownUntil } }, activeTier, activePid }`. Cooldown expirado → limpa.
- **`nio agent`** ganha `next` (força avanço), `reset`, `tiers`; `status` mostra
  tier + cooldowns.
- **`nio init` handoff** chama `AgentOrchestrator.run()` em vez do `spawn` direto.
- **API keys** — `nio agent setup` (ou `.env`) coleta `DASHSCOPE_API_KEY` /
  `MOONSHOT_API_KEY`.

---

## Ordem de execução

1. **Parte A** completa (A1→A5), `tsc` + `bun test` verde, smoke dos dois caminhos.
2. Checkpoint com o dono → plano detalhado da **Parte B**.
3. Parte B → plano detalhado da **Parte C**.

## Fora de escopo (registrar)

- Scan automático de saída via `node-pty` — enhancement da Parte C.
- Lock forte de modelo (`managed settings`) — questão aberta separada.
- Rodar Qwen/Kimi localmente (inferência) — inviável (1T params); são APIs hospedadas.
- 4º+ tier / tiers paralelos — a ordem é estritamente serial 1→2→3.
