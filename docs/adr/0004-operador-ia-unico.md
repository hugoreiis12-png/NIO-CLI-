---
id: "0004"
title: Operador de IA único (OpenCode/big-pickle) — multi-cliente adiado
status: accepted
created: 2026-08-29
---

# Operador de IA único (OpenCode/big-pickle) — multi-cliente adiado

## Contexto

Em 27 jul 2026 a superfície ativa de clientes de IA já tinha sido restrita a só
OpenCode (`ALL_TARGETS = [opencodeTarget]`, `ensureCoreClients` só checa OpenCode);
em 24 ago 2026 (`docs/v2/ARQUITETURA-CLIENTE-IA.md`) fechou-se a decisão de a
NIO-CLI ser **autocontida** — `nio init` embute um operador fixo (OpenCode rodando
`opencode/big-pickle`) e entrega o terminal pra ele no fim do wizard.

Em 27 ago 2026 (commit `ffd13c3`, `docs/v2/PROGRESSO.md` — "Arquitetura de clientes
de IA, Parte A") começou uma evolução faseada: **Parte A** — `nio init` detecta
**OpenCode ou Codex** no host e sobe o que existir, com `nio agent status`,
tradução de config pro Codex e `handoffToOperator` dinâmico; **Partes B/C** (só
planejadas) — proxy Headroom para compressão de contexto e um ladder de failover
que troca o modelo (Qwen → Kimi via container) quando o primário esgota a quota.

## Decisão

**A arquitetura multi-cliente / failover vira feature futura.** A CLI volta ao
**operador único fixo: `opencode` + `opencode/big-pickle`** (a decisão de 24 ago,
que a Parte A tinha "superado em parte").

- **Parte A revertida** (commit `ffd13c3`, subconjunto de 17 arquivos):
  `src/lib/primary-client.ts` e `src/cli/commands/agent.ts` removidos;
  `ensureCoreClients` (só OpenCode) restaurado no lugar de `resolvePrimaryClient`;
  `ALL_TARGETS = [opencodeTarget]`; `handoffToOperator()` volta a `spawn("opencode",
  [], { stdio: "inherit" })` fixo; `UserConfig.primaryClient` removido.
- O modelo `opencode/big-pickle` (`NIO_OPERATOR_MODEL` em `client-configs.ts`,
  gravado por `planOpencodeUpdate`/`installOpencodeGlobal`) **não muda** — é
  independente do caminho revertido.
- O **motor de config do Codex** (`codexTarget`, `toCodexDocs`, `planCodexUpdate`,
  `installCodexGlobal`) fica **dormente no repo** (estado dele antes de `ffd13c3`,
  desde 27 jul) — não é apagado. A feature futura o reaproveita.
- O trabalho da Parte A fica **preservado no histórico do git** (`ffd13c3`) e o
  desenho das 3 partes fica versionado em
  `docs/v2/ARQUITETURA-CLIENTES-MULTI-FUTURO.md`.

## Consequências

**Positivas:**
- Modelagem da CLI segue com um alvo só (OpenCode/big-pickle) — sem ramificar
  cada passo do `init`/provisão/handoff em "qual cliente".
- `src/cli/commands/init/provision-step.test.ts`, que estava quebrado no HEAD
  (importava `ClientChoice`, removido em `ffd13c3`), volta a compilar.
- Reverter é barato e não destrutivo: o motor Codex e o histórico ficam; retomar
  a feature é re-plugar, não recomeçar.

**Negativas / trade-offs:**
- Quem tem só Codex no host (não OpenCode) não é mais detectado — `nio init`
  orienta a instalar OpenCode. Aceito: o público-alvo usa OpenCode/big-pickle.
- O lock de modelo continua **soft** (default no `opencode.json`, não garantia) —
  limitação pré-existente, documentada em `ARQUITETURA-CLIENTE-IA.md`.

## Alternativas consideradas

- **Manter a Parte A e só pausar B/C:** descartado — a detecção multi-primário já
  adiciona ramificação (prompt "OpenCode ou Codex", 2 formatos de config, 2 alvos
  de provisão) sem valor enquanto a modelagem é feita com um cliente só.
- **Apagar o motor Codex dormente junto:** descartado — a feature futura precisa
  dele; o `ARQUITETURA-CLIENTE-IA.md` já o documenta como órfão-aceito desde 27 jul.
- **`git revert ffd13c3`:** inviável — `ffd13c3` carrega também Sprint 4/5
  (SessionManager, recipes, tools `nio_session_*`/`nio_env_*`); reverter o commit
  inteiro perderia esse trabalho. Feita reversão cirúrgica do subconjunto.

## Referências

- `docs/v2/ARQUITETURA-CLIENTE-IA.md` — o desenho do operador fixo (volta a valer por inteiro).
- `docs/v2/ARQUITETURA-CLIENTES-MULTI-FUTURO.md` — desenho parkeado das Partes A/B/C.
- `docs/v2/PROGRESSO.md` — entrada de 27 ago (Parte A) + entrada de 29 ago (reversão).
- commit `ffd13c3` — a Parte A implementada, no histórico.
