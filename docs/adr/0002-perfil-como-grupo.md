---
id: "0002"
title: "Grupo" do cadastro é perfil de ambiente, com provisionamento automático
status: accepted
created: 2026-07-27
---

# "Grupo" do cadastro é perfil de ambiente, com provisionamento automático

## Contexto
`docs/ROADMAP.md` (P06) previa "usuário escolhe seus grupos no cadastro do
`nio init`" sem definir o que é um grupo — decisão de produto deliberadamente
adiada pra Fase 0. Era a última premissa fechando a Fase 0 e a única que
destrava a Fase 1 inteira (roadmap: "P06 destrava a Fase 1").

## Decisão
"Grupo" = **perfil de ambiente**, escolhido pelo colaborador logo após
autenticar no `nio init`: **Desenvolvedor, Analista de Dados, Cientista de
Dados, Business Intelligence**. A escolha:
1. Dirige a configuração e instalação do ambiente **100% automaticamente**
   (sem confirmação passo a passo) — skills, rules e dependencies filtradas
   pelo perfil.
2. Fica gravada **por usuário**, não por máquina/repo — dois colaboradores
   na mesma máquina mantêm perfis distintos; o mesmo colaborador mantém o
   perfil entre repos diferentes.

Reaproveita mecânica que já existia no repo antes desta decisão: a
taxonomia `role → área → stack` de `src/lib/sections.ts`, que já dirige
skills/rules/dependencies via `Selection`. Os 4 perfis são roles novos
nessa mesma taxonomia (`dev` já existe; `data-analyst`, `data-scientist`,
`bi` são novos), não um mecanismo paralelo.

## Consequências
**Positivas:**
- Zero trabalho de green-field pra listar/filtrar conteúdo por perfil — é
  extensão de algo que já funciona e já tem testes.
- Provisionamento automático elimina a fricção de prompts `[y/N]` repetidos
  no `init` pra quem só quer o ambiente do seu perfil pronto.

**Negativas / trade-offs:**
- Move o estado de "config por-máquina" (`nio.user.json`, hoje ao lado do
  binding do repo) pra "config por-usuário" (`~/.nio/users/<id>.json`) —
  muda onde o dado vive, exige migração cuidadosa (`docs/PLANO-EXECUCAO.md`,
  U23) pra não perder preferências já salvas de quem já usa o formato
  antigo.
- Os 4 perfis dependem de pastas correspondentes existirem no repo externo
  de skills (`nio-skills`) — é uma dependência cross-repo que este ADR não
  resolve sozinho (rastreada em `docs/PLANO-EXECUCAO.md`, U22).
- "Permissão = mesma dimensão de perfil" (decisão paralela, ver ADR 0003 e
  spec `docs/specs/auth/0002`) significa que, quando a auth voltar a ser
  trabalhada, o perfil vira também um dado de controle de acesso — hoje ele
  é só local/client-side, então virar fonte de permissão exige uma fonte
  server-side que ainda não existe (documentado como placeholder removido
  na spec 0002).

## Alternativas consideradas
- **Grupo = squad/time do usuário** (RH/organograma): descartado — não
  existe hoje no domínio, exigiria modelar identidade organizacional do
  zero sem um caso de uso imediato puxando isso.
- **Perfil escolhido livremente, texto aberto:** descartado — perde o
  benefício central (provisionamento automático via taxonomia existente,
  que depende de valores conhecidos/enumeráveis).
- **Manter o estado por-máquina** (não por-usuário): descartado — não
  atende o critério de pronto da Fase 2 do roadmap ("dois usuários no mesmo
  host têm identidades, perfis e prefixos de tool distintos").

## Referências
- `docs/ROADMAP.md` — Fase 0 (P06), Fase 2 (U21-U26).
- `docs/PLANO-EXECUCAO.md` — Fase 2, cards U21-U26 (desmembramento executável).
- `src/lib/sections.ts` — taxonomia `role → área → stack` reaproveitada.
