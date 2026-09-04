---
id: "0009"
title: Headroom best-effort — fallback em 3 níveis (amenda a 0007)
status: accepted
created: 2026-09-04
amends: "0007"
---

# Headroom best-effort — fallback em 3 níveis (amenda a 0007)

## Contexto

A [ADR 0007](0007-headroom-proxy-obrigatorio.md) tornou o Headroom **obrigatório**
pro client de IA: sem ele, `ensureHeadroomAndWire` lançava `HeadroomRequiredError` e
o `nio ai` **não iniciava**. Como o Headroom roda em container, isso amarra o client
de IA a ter **Docker** na máquina.

Surgiu um caso real: um integrante do time **não pode instalar/rodar Docker**
(restrição de memória). Com a regra da 0007, esse usuário fica **bloqueado** do
client de IA — perde a experiência que os outros têm, mesmo o resto da CLI
(orquestração de ambientes: `init`/`sessions`/`deps`/`materialize`) não depender de
Docker em nada.

Requisito do dono: o Headroom indisponível **não pode bloquear** o usuário — a CLI
deve **oferecer um fallback** pra ele seguir usando o client de IA.

## Decisão

O Headroom deixa de ser bloqueante e vira **best-effort**. `ensureHeadroomAndWire`
resolve o `provider.opencode.options.baseURL` em **3 níveis de precedência** e
**nunca lança**:

1. **REMOTO** — `NIO_HEADROOM_URL` setado → usa esse Headroom (ex.: o compartilhado
   do host do time), **sem Docker local**. Experiência plena, com compressão.
2. **LOCAL** — senão, com Docker disponível → sobe o container local (comportamento
   da 0007).
3. **DIRETO** (fallback) — senão → **não bloqueia**: aponta o OpenCode direto no LLM
   upstream (`HEADROOM_UPSTREAM`, default OpenCode Zen), **sem compressão**, com aviso
   claro no terminal.

`ensureHeadroomAndWire` passa a **devolver o modo** (`'remote' | 'local' | 'direct'`).
`HeadroomRequiredError` fica `@deprecated` (nunca mais lançado); os `catch` nos
chamadores (`ai.ts`, `docker-manager.ts`, `init/handoff.ts`) viram defensivos.

## Consequências

- **Ninguém é bloqueado** por falta de Docker. O usuário sem Docker segue no `nio ai`.
- **Mesma experiência (com compressão)** pra quem sem Docker, apontando
  `NIO_HEADROOM_URL` pro Headroom compartilhado (nível 1) — casa com o stack de deploy
  (o serviço `headroom` já existe lá; basta expô-lo na LAN).
- **Trade-off no nível 3:** sem compressão = mais tokens e risco em contextos grandes
  — exatamente o que a 0007 queria evitar. É o **último recurso**, sempre com aviso,
  nunca o caminho preferido.
- A orquestração de ambientes nunca dependeu do Headroom — permanece intacta.

## Alternativas descartadas

- **Manter obrigatório (0007 pura):** bloqueia o usuário sem Docker. Rejeitado pelo
  requisito.
- **Só remoto obrigatório:** manteria a compressão sempre, mas ainda bloqueia se o
  usuário não configurar `NIO_HEADROOM_URL`. Não atende "nunca bloquear".
- **Só degradar direto:** simples, mas joga fora o Headroom compartilhado (todo mundo
  sem Docker ficaria sem compressão). O modelo de 3 níveis cobre os dois mundos.

## Implementação

- `src/app/ai-client.ts` — `ensureHeadroomAndWire` (3 níveis, devolve `HeadroomMode`).
- `src/lib/headroom.ts` — `HEADROOM_UPSTREAM` (alvo do modo direto).
- `src/tui/launch.tsx`, `launchAiClient` — herdam o fallback (não tratam mais erro).
