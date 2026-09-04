---
id: "0010"
title: Headroom desativado — client de IA direto no LLM (amenda 0007+0009)
status: accepted
created: 2026-09-04
amends: "0007, 0009"
---

# Headroom desativado — client de IA direto no LLM (amenda 0007+0009)

## Contexto

A [ADR 0007](0007-headroom-proxy-obrigatorio.md) tornou o Headroom (proxy de compressão
de contexto) **obrigatório**; a [0009](0009-headroom-best-effort-fallback.md) o tornou
**best-effort** (fallback em 3 níveis) pra não bloquear quem não tem Docker.

Um mapeamento mais detalhado mostrou que, no fluxo atual, o Headroom traz **mais custo
que ganho**:

- **Mismatch de versão** entre o `opencode serve` (que a TUI sobe) e o `@opencode-ai/sdk`
  do cliente quebra o stream de eventos — a TUI abre mas a resposta nunca chega.
- **Falsos-positivos de modelo** (LiteLLM interno rejeitando/roteando model) confundiram
  o diagnóstico do "não responde".
- Uma **camada extra** (container + porta + auth passthrough + versão) pra manter, sem
  benefício claro pro operador no dia a dia.

## Decisão

**Desativar o Headroom.** O client de IA (`nio ai`/TUI e `launchAiClient` headless)
passa a falar **direto no OpenCode Zen**, sem proxy de compressão.

- `ensureHeadroomAndWire` (`src/app/ai-client.ts`) **não usa mais** Headroom: não sobe
  container, não lê `NIO_HEADROOM_URL`, e grava o `opencode.json` com o provider
  `opencode` **sem** `baseURL` (direto) + o model default `opencode/big-pickle`.
- `installOpencodeGlobal` sem `headroomUrl` agora **limpa** qualquer `baseURL` de
  Headroom que tenha sobrado (`clearOpencodeProviderBaseURL`).
- **Não removido, só dormente** (remover mexeria em ADRs/composes/comandos/testes —
  risco desnecessário): `src/lib/headroom.ts`, o comando `nio docker headroom`, e o
  serviço `headroom` nos composes continuam existindo, apenas **não são acionados** pelo
  client de IA.
- `HeadroomRequiredError` fica `@deprecated` (nunca lançado); os `catch` viram defensivos.

## Consequências

- O `nio ai` responde **direto** (validado: `opencode run` → resposta, sem Headroom).
- **Sem compressão de contexto** → mais tokens por chamada (trade-off aceito; era o que
  a 0007 evitava, mas o custo operacional do Headroom não compensou).
- **Uma peça a menos**: sem dependência de Docker, da porta do Headroom, nem do
  casamento de versão serve×SDK **por causa do Headroom** (o casamento serve×SDK ainda
  importa pra própria TUI, mas isso é do OpenCode, não do Headroom).
- **Reativar** = reintroduzir a chamada de `ensureHeadroomRunning` + gravar o `baseURL`
  (o código dormente ainda está lá).

## Modelo do operador

O default segue **`opencode/big-pickle`** (`NIO_OPERATOR_MODEL`), confirmado **válido**
e respondendo direto no Zen. Modelos válidos alternativos: `claude-opus-4-8`,
`claude-opus-5`, `claude-sonnet-5`, `claude-fable-5`.
