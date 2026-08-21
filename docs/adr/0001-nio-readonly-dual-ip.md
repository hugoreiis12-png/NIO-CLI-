---
id: "0001"
title: NIO read-only sobre PostgreSQL, dois bancos, time tracking local
status: accepted
created: 2026-07-27
---

# NIO read-only sobre PostgreSQL, dois bancos, time tracking local

## Contexto
O NIO pivota de "CLI que administra o NOS (kanban) via Supabase" pra uma
ferramenta de investigação/observabilidade que consulta PostgreSQL
diretamente, em profundidade, mantendo a escrita de domínio (tasks,
alocações) num sistema interno separado (Fase 4 do roadmap). Duas
infraestruturas de banco coexistem hoje — um IP antigo e um IP novo — e cada
projeto vive num dos dois. Fonte completa do racional: `docs/ROADMAP.md`,
Fase 0.

Estas são as premissas fechadas que **destravam a Fase 1** do roadmap
(fundação read-only dual-IP) e que, por regra do próprio roadmap, só podem
ser reabertas via um ADR novo — não por edição silenciosa do documento.

## Decisão
1. **Dois destinos de banco, explícitos.** O adapter de investigação
   conhece dois IPs/hosts de PostgreSQL (antigo e novo). Nunca há um
   terceiro default implícito.
2. **Um projeto vive num banco só por vez.** A relação projeto→banco é
   dado, não inferência — resolvida por config, nunca adivinhada.
3. **NIO alterna o alvo por contexto de consulta**, aprofundando a pesquisa
   dentro do banco resolvido (schema, conteúdo, joins) — não só metadados.
4. **Acesso é exclusivamente DQL.** Sem DML, DDL ou DTL em nenhuma
   circunstância — nem para conveniência de desenvolvimento. Ver Invariante
   #1 abaixo.
5. **Time tracking nasce local**, em `~/.nio/`, sem persistência em banco
   nesta fase — evita acoplar cronometragem de trabalho a uma infra de
   investigação que é, por definição, read-only.

## Invariantes (valem em todas as fases seguintes)
Copiados do roadmap pra ficarem citáveis a partir deste ADR:
1. O adapter PostgreSQL é **read-only** — somente DQL.
2. Escrita de domínio existe **apenas** no adapter do sistema interno (Fase 4).
3. Toda consulta é observável: tempo, origem, banco alvo, rastreio.
4. O banco alvo é sempre **explícito** — nunca inferido por default silencioso.
5. Refatoração estrutural (Fase 6) não altera comportamento nem ports públicos.

Qualquer PR que viole um destes é rejeitado, independente de conveniência.

## Consequências
**Positivas:**
- Impossível emitir escrita acidental contra dados de investigação — a
  superfície de risco de um bug em `nio` corromper produção via consulta
  fica estruturalmente fechada.
- Dois bancos explícitos evitam a armadilha de "funciona no meu projeto,
  quebra no do colega" por assumir o IP errado default.

**Negativas / trade-offs:**
- Sem escrita nenhuma nesta camada, qualquer necessidade futura de anotar/
  corrigir dado observado precisa passar pelo sistema interno (Fase 4) —
  mais um salto de infraestrutura antes de existir.
- Time tracking local (não sincronizado) tem os limites já conhecidos de
  estado só-numa-máquina — aceito conscientemente como ponto de partida,
  não solução final (ver Fase 7 do roadmap, G71-G75, puxada só sob dor
  real).

## Alternativas consideradas
- **Um adapter só, com um IP default e override manual:** descartado —
  viola diretamente o Invariante #4 (nunca default silencioso) e o
  cenário real (dois bancos vivos simultaneamente, por projeto).
- **Permitir DML controlado atrás de uma allowlist de comandos:** descartado
  — a superfície de "allowlist que pode ter buraco" é estritamente pior que
  "a role do banco fisicamente não aceita escrita" (defesa em profundidade,
  ver `docs/PLANO-EXECUCAO.md`, F12-T3).
- **Time tracking direto num banco compartilhado desde o início:** descartado
  por ora — acopla uma feature de UX (cronometrar tempo) a uma decisão de
  infraestrutura (onde persistir) antes de precisar; local em JSON resolve o
  caso de uso imediato sem essa dependência.

## Referências
- `docs/ROADMAP.md` — Fase 0, Fase 1, seção Invariantes (fonte primária).
- `docs/PLANO-EXECUCAO.md` — Fase 1 (F11-F16), onde estas premissas viram
  tasks executáveis.
