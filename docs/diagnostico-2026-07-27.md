# Diagnóstico da aplicação vs. Roadmap — 2026-07-27

> Registro de log gerado sob demanda. Cruza o estado real do código (`src/`) com
> o `ROADMAP.md`/`PLANO-EXECUCAO.md`, dizendo **o que já roda / é usável** e em
> **qual camada**. Fonte de verdade do status por-fase continua sendo o
> `PLANO-EXECUCAO.md`; este arquivo é uma foto de prontidão.

## Sinais de saúde (medidos agora)

| Sinal | Resultado |
| --- | --- |
| `bunx tsc --noEmit` | ✅ verde |
| `bun run build` | ✅ gera `dist/` (tsc + copy de `cli/copy`) |
| `bun test` | ✅ 226 pass / ❌ 2 fail — **só** `EPERM: symlink` no Windows (`dependencies.test.ts`, `provision.test.ts`); ambiental, exige Developer Mode, não é regressão |
| Tools MCP registradas | 20 (`src/tools/index.ts`) |
| Adaptadores de dados | 1 — `src/adapters/supabase/` (sem `postgres/`) |

## Prontidão por camada

### ✅ 1. Camada de setup da CLI — **USÁVEL HOJE**
`nio init`, `sync`, `skills`, `exec`, `plan`, `validate-plan`, `completion`,
`status`, `clean-legacy`.

- **`nio init` agora roda sem autenticação** (setup local: clientes de IA,
  skills/commands, seleção role/stack, IDE, hooks, harness). Com credenciais,
  faz o fluxo completo com vínculo de projeto. É a camada mais madura.
- Provisionamento (`lib/provision.ts`, `targets.ts`, `hooks.ts`) e serving de
  skills (`lib/skill-serve.ts`, `skills-cache.ts`) funcionam com degradação
  offline.
- **Veredito:** pronta para uso real por um dev que só quer as skills/harness.

### ✅ 2. Arquitetura hexagonal / porta de dados — **SÓLIDA**
`core/ports.ts`, `core/types.ts`, `session-factory.ts`, `adapters/supabase/*`.

- Contrato neutro bem definido; `session-factory` tem o único `switch` de
  backend (hoje só `supabase`). É exatamente o encaixe onde o adapter Postgres
  (F12) entra sem tocar tools. **Veredito:** fundação pronta para a Fase 1.

### ⚠️ 3. Camada de autenticação (PAT via Supabase) — **CÓDIGO-COMPLETO, BLOQUEADA POR BACKEND**
`auth.ts`, `cli/commands/auth.ts` (`login`/`whoami`/`logout`).

- Fluxo implementado e testado, mas **dois bloqueios cross-sistema** (ambos já
  documentados em `brand.ts` e na spec de rebrand):
  - `patPrefix = 'nio_'` porém o backend hoje valida `noc_` (F11-T0.4). Login
    real de token novo **quebra** até o backend aceitar o prefixo.
  - `brand.webUrl = ''` → o comando não imprime link de "gere seu token"
    (mecanismo definitivo pendente em `docs/specs/auth/0002-cli-native-login.md`).
- **Veredito:** usável só para quem já tem PAT válido aceito pelo backend
  atual. Não confiar para onboarding novo até o backend coordenar o prefixo.

### ⚠️ 4. Servidor MCP + 20 tools (`nos_*` / `nio_*`) — **RODA, MAS EXIGE SESSÃO**
`mcp-server.ts`, `tools/*`.

- Servidor sobe (stdio), lista tools/resources/prompts, auto-pull e cache de
  skills funcionam. **Toda tool de domínio exige sessão autenticada** — sem
  login retorna "não autenticado". Logo, herda o bloqueio da camada 3.
- Contra o roadmap: essas tools ainda **escrevem** no Supabase
  (`create/update/move/comment/*_allocation`). O direcionamento novo é
  read-only + escrita migrando pro sistema interno (T36/Fase 4) — ainda não
  feito. **Veredito:** funcional para o modelo antigo; divergente do alvo.

### ⏸️ 5. Gateway de Auth dedicado (OAuth2 + PKCE) — **PAUSADO E ÓRFÃO**
`src/gateway/*` (`server.ts`, `sessions.ts`, `pkce.ts`, `authorize-*`, `traceability.ts`).

- `Bun.serve()` standalone, com testes (`pkce.test.ts`, `sessions.test.ts`).
- **Não está ligado** a `cli.ts`, `mcp-server.ts` nem `session-factory.ts` —
  caminho morto no runtime atual. Status `paused` no `docs/adr/0003-*` e na
  spec `docs/specs/auth/0002-*`. **Veredito:** não conta como camada usável
  hoje; é trabalho preservado para retomar.

### ❌ 6. Investigação read-only PostgreSQL dual-IP (F12–F16) — **NÃO CONSTRUÍDA**
- Sem `src/adapters/postgres/`, sem `InvestigationGateway` em `core/ports.ts`.
  É o próximo grande bloco do roadmap (Fase 1) e depende de **P0-T2**
  (credenciais/role DQL-only — dono Manual, ainda `[ ]`). **Veredito:** 0%.

### ❌ 7. Sistema interno de escrita (Fase 4) e Investigação de dados (Fase 5) — **NÃO INICIADAS**

## Status vs. Roadmap (resumo)

| Fase | Estado |
| --- | --- |
| 0 — Decisões | ✅ quase toda; falta **P0-T2** (credenciais, Manual) |
| 1 — Fundação read-only dual-IP | 🟡 **F11 rebrand feito** (2 pendências de backend); **F12–F16 = 0%** |
| 2 — Identidade/grupos | ⬜ não iniciada (base existe em `lib/sections.ts`) |
| 3 — Tools core read-only | ⬜ (tools existem mas ainda com escrita) |
| 4 — Sistema interno | ⬜ |
| 5 — Investigação de dados | ⬜ |
| 6 — Refactor mecânico | ⬜ |
| 7 — Escala | ⬜ |

## Conclusão executiva

**Pronto para rodar/usar hoje:** a camada de setup da CLI (`nio init` local +
skills/harness/hooks) e a arquitetura de dados. **Parcialmente usável:** MCP +
tools e login, ambos travados pelo descasamento de prefixo de PAT (`nio_` vs
`noc_`) no backend. **Não existe ainda:** todo o núcleo do direcionamento novo
(Postgres read-only, sistema interno, investigação).

**Caminho crítico para destravar valor:**
1. **P0-T2** (credenciais + role DQL-only) — desbloqueia toda a Fase 1 técnica.
2. **F11-T0.4** (backend aceitar prefixo `nio_`) — desbloqueia login/tools reais.
3. **F12-T1** (desenho do `InvestigationGateway`) — pode começar já, contra
   fixture, sem depender de (1).