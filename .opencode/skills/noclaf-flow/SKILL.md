---
name: noclaf-flow
description: Guia o agente através do fluxo linear de trabalho com NOS (noclaf): listar tasks, mover entre status, iniciar/encerrar task_allocation e bater ponto do dia. Use quando o usuário pedir para "pegar uma task", "começar a trabalhar", "próxima task", "movi pra done", "parei essa task", "encerrar dia" ou "bater ponto", ou ao chamar qualquer tool `nos_*` de task/alocação.
---

# Fluxo NOS

Este servidor expõe duas famílias de "alocação" que são fáceis de confundir:

- `nos_end_task_allocation` — para SÓ o timer de uma task. O ponto do dia continua aberto.
- `nos_end_allocation` — bate ponto de SAÍDA do dia (e, como efeito colateral, fecha qualquer task_allocation aberta).

## Regras duras

1. O agente **NUNCA** chama `nos_end_allocation` sem o usuário pedir explicitamente — frases como "encerrar dia", "bati ponto", "saí", "vou embora". Qualquer outra coisa ("termina essa task", "para o timer", "movi pra done") usa `nos_end_task_allocation`.
2. Ao mover uma task para status terminal com task_allocation ativa, **sempre perguntar** antes de encerrar a task_allocation.
3. Nunca chamar `nos_start_allocation` manualmente — `nos_start_task_allocation` abre o dia automaticamente.
4. Se `nos_end_allocation` for chamado por engano, **avisar imediatamente** o usuário e oferecer para reabrir.

## Fluxo linear esperado

1. `nos_list_tasks` filtrado pelo usuário → escolher uma.
2. `nos_move_task` → `doing`.
3. `nos_start_task_allocation` (se ainda não tem ponto, abre automático).
4. Trabalho na task.
5. `nos_move_task` → `done` / `qa` / `code_review` / `rejected`.
6. Agente **pergunta** "encerrar o timer dessa task?". Se sim → `nos_end_task_allocation`. Se for pegar outra agora, pula pro passo 7 (transição é atômica).
7. Próxima task: `nos_start_task_allocation` na nova — fecha a anterior sozinho.
8. Quando o usuário encerra uma task **sem pegar outra**, o agente **pergunta** "é fim do dia?". Só com confirmação verbal explícita chama `nos_end_allocation`.
