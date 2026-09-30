# ADR 0015 — `exec-delegate` fica fora do sistema de tasks duráveis

- **Data**: 2026-09-30
- **Status**: aceita
- **Contexto**: fatia 1.12 da F1 (ver `docs/arch/ARQUITETURA-DURABLE-TASKS-E-MEMORIA.md`)

## Contexto

A F1 introduziu execução durável (`tasks` / `task_steps`, `nio-worker`). O plano
previa que a fatia final absorvesse o `exec-delegate` — o outro sistema de job do
repositório — para não manter dois stores. A motivação era legítima: ele guarda
estado num `Map` em memória com espelho em `~/.nio/exec-jobs/*.json`, que é
por-máquina, sem retry e sem trilha.

Ao implementar, três fatos mudaram o cálculo.

**1. `nio exec` tem um consumidor fora deste repositório.** O cabeçalho de
`src/cli/commands/exec.ts` declara o contrato:

> Superfície de CLI da delegação headless — o que o nio Studio (Tauri) chama.
> Contrato: **stdout = JSON** (parseável), **stderr = log ao vivo** (streamável).

O JSON emitido é o shape `ExecJob`. Absorver trocaria por `Task`, quebrando um
aplicativo que não faz parte deste release.

**2. Hoje não exige banco nem autenticação.** `nio exec` roda contra um worktree
local sem tocar no Postgres, e `tools/delegate-exec.ts` nem lê `ctx.user`. Como
`tasks.user_id` é `NOT NULL`, absorver passaria a exigir usuário logado e conexão
de banco num fluxo que hoje funciona offline.

**3. Os benefícios não se aplicam.** O que a durabilidade compra — sobreviver ao
processo, retomar do último checkpoint, retry, trilha por passo — vale para
trabalho agêntico longo e multi-passo. O `exec-delegate` é síncrono, de passo
único (uma chamada ao Qwen), e o resultado que importa fica no worktree e no git,
não no registro do job.

## Decisão

**`exec-delegate` permanece com store próprio.** Não é absorvido pelo sistema de
tasks. `nio exec`, `nio_delegate_exec` e `nio_exec_status` mantêm shape, contrato
e independência de banco.

Em contrapartida, o defeito real que motivava a absorção foi corrigido: o
diretório crescia para sempre. Agora há retenção de 7 dias
(`EXEC_JOB_RETENTION_DAYS`, poda na criação de cada job) e teto de 50 entradas no
cache em memória (`MAX_JOBS_IN_MEMORY`) — o servidor MCP é long-lived e retinha
todo job da sessão.

## Consequências

**Aceitas:**
- O repositório tem dois modelos de execução. A separação passa a ser explícita,
  não acidental: **task durável** para trabalho agêntico multi-passo com tools;
  **exec-delegate** para delegação síncrona de passo único num worktree.
- A fatia 1.12 do plano de F1 fica registrada como *não implementada por decisão*,
  não como pendência.

**Reabrir se:**
- O nio Studio puder ser atualizado em conjunto e alguém quiser o histórico de
  execuções compartilhado entre máquinas; **ou**
- o `exec-delegate` deixar de ser de passo único (ex.: ganhar tools ou iteração),
  quando os benefícios da durabilidade passariam a valer.

Nesse caso o caminho é uma coluna discriminadora (`tasks.kind`) para o worker não
reivindicar jobs de exec com o motor errado, mais um adaptador `ExecJob ← Task`
para preservar o contrato do Studio.

## Alternativas descartadas

| Alternativa | Por que não |
|---|---|
| Absorver com camada de compatibilidade | Mantém o payload, mas acopla `nio exec` a banco + login, e exige `tasks.kind` + segundo executor. Custo alto para benefício que não se aplica a passo único. |
| Absorver mudando o contrato | Mais limpo internamente, mas exige release coordenado com o Tauri. Fora do controle desta entrega. |
