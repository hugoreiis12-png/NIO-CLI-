---
id: "0002"
title: Engine selection for headless exec (codex | claude)
area: exec
status: done
created: 2026-07-22
issue:
---

# Engine selection for headless exec (codex | claude)

## Problema
A delegação headless (`noclaf exec`, e as tools MCP) roda **só o Codex** — o resolvedor
procura o binário `codex` e monta `codex exec …`, com tudo chumbado no nome. Quem quer planejar
com um modelo e executar com outro, ou usar o Claude na execução, não tem como pedir: o motor
não sabe escolher engine. O Studio precisa disso pra o seletor de agente virar escolha real.

## Solução
O `noclaf exec` aceita **qual engine usar**. Hoje `codex` e `claude`; amanhã mais. O motor
resolve o binário e monta o comando headless certo pra cada engine, mantendo todo o resto igual
— o mesmo worktree, o mesmo prompt ancorado no harness, os mesmos checks determinísticos, o
mesmo contrato de saída (stdout JSON / stderr log). Se o engine pedido não estiver disponível,
a falha diz exatamente qual instalar/logar.

## Histórias de usuário
1. Como caller (Studio ou humano), quero escolher o engine da execução, para usar o modelo certo para a tarefa.
2. Como caller, quero que o engine padrão continue sendo o codex, para nada que já funciona quebrar.
3. Como caller, quero uma falha clara quando o engine escolhido não está instalado/logado, para saber o que resolver.
4. Como mantenedor, quero adicionar um engine novo num só lugar, para não caçar `codex` chumbado pelo código.
5. Como caller MCP, quero o mesmo controle de engine pela tool de delegação, para o Cowork ter a mesma escolha do CLI.

## Escopo
Seleção de engine na camada de delegação headless: a flag no `noclaf exec`, o argumento
equivalente nas tools MCP (`noclaf_delegate_exec`), um registro de engines (binário + como
montar o comando headless + como auto-aprovar), e a resolução/erro por engine.

### Fora de escopo
- Adicionar engines além de **codex** e **claude** (o registro deixa isso fácil, mas só esses dois entram agora).
- Roteamento automático por fase (planejar↔executar em engines diferentes) — quem decide o engine é o caller; automação é outra spec.
- Qualquer UI. O seletor do Studio consome esta flag numa spec própria lá.
- Mudar o contrato de saída (stdout JSON / stderr log / exit code) — permanece idêntico.
- Mudar o prompt ancorado no harness ou os checks determinísticos — idênticos entre engines.

## Restrições
- Segue o harness (`docs/_rules/noclaf.md`): arquivo < 300 linhas, função < 30 linhas, comentário ≤ 1 linha.
- **Compatibilidade:** sem `--engine`, o comportamento é **exatamente** o de hoje (codex). Nada que já chama o `exec` pode quebrar.
- Cada engine roda **na assinatura** do provedor (sem API): codex via `codex exec`, claude via `claude -p` — mesma abordagem que o `runPatternsAnalysis` já usa.
- Auto-aprovação é **por engine** (codex e claude têm flags diferentes) e continua sobrescrevível por env, como hoje.
- O resolvedor precisa achar o binário mesmo com **PATH mínimo** (o MCP é spawnado por app GUI) — a busca em locais conhecidos vale para todo engine, não só codex.

## Questões em aberto
<!-- vazio -->

## Decisões de implementação
- **Registro de engines:** um mapa central `codex | claude → { binário, candidatos de PATH, override de env do binário, como montar os args headless a partir do prompt, override de env dos args }`. É o único lugar que conhece nomes de binário e flags. Adicionar engine = adicionar uma entrada.
- **Resolução generalizada:** o `resolveCodexBin` de hoje vira `resolveEngineBin(engine)` — tenta o override de env, depois o binário no PATH, depois os candidatos conhecidos daquele engine. Mantém `NOCLAF_CODEX_BIN` funcionando e ganha o equivalente para claude.
- **Montagem do comando:** o `spawn` deixa de assumir `codex exec --full-auto` e passa a pedir os args ao registro do engine escolhido: codex → `exec --full-auto <prompt>`; claude → `-p <prompt> --permission-mode acceptEdits` (o mesmo já usado na análise de patterns). Cada um sobrescrevível por env próprio.
- **Prompt inalterado:** `buildPrompt` (ancorado em AGENTS.md + rules + patterns) é idêntico para todo engine — o contexto do harness não depende de quem executa.
- **API pública:** `startExec`/`runExec` ganham um campo `engine` opcional (default `codex`). O job já carrega `engine`; passa a refletir o realmente usado.
- **CLI:** `noclaf exec` ganha `--engine <codex|claude>` (default codex). Valor inválido → erro claro listando os suportados.
- **MCP:** `noclaf_delegate_exec` ganha o mesmo argumento `engine` opcional, com a mesma validação e default.
- **Erro por engine:** engine ausente/não logado devolve um job `failed` cujo `error` nomeia o engine e o que fazer (ex.: "claude não encontrado — instale/logue ou defina NOCLAF_CLAUDE_BIN").

### Fluxo (Mermaid)
```mermaid
flowchart TD
```

## Decisões de teste
- Prior art: funções puras testadas isoladas (como no resto do CLI).
- Alvos: a **montagem de args por engine** (codex vs claude, com e sem override de env) e a **validação/normalização do valor de `--engine`** (válido, inválido, ausente → default).
- O spawn real de codex/claude **não** entra em teste unitário — verificação manual pelos critérios.

## Tarefas
- [x] T1 · Registro central de engines (binário, candidatos, envs, montador de args) cobrindo codex e claude.
- [x] T2 · `resolveEngineBin(engine)` generalizando o resolvedor atual, com os envs de override por engine.
- [x] T3 · `spawn` monta os args a partir do registro do engine escolhido; codex mantém o comportamento atual.
- [x] T4 · `startExec`/`runExec` aceitam `engine` (default codex) e o job reflete o engine usado.
- [x] T5 · `noclaf exec --engine <codex|claude>` com validação e default; sem a flag, comportamento idêntico ao atual.
- [x] T6 · `noclaf_delegate_exec` aceita `engine` com a mesma validação e default.
- [x] T7 · Erro por engine ausente/não logado, nomeando o engine e a ação.

## Critérios de aceitação
- [x] (T4, T5) Dado nenhum `--engine`, quando rodo `noclaf exec`, então usa codex — igual a hoje, sem regressão.
- [x] (T1, T3, T5) Dado `--engine claude`, quando rodo `noclaf exec`, então a execução usa o `claude` em modo headless auto-aprovado.
- [x] (T1, T3, T5) Dado `--engine codex`, quando rodo `noclaf exec`, então a execução usa `codex exec --full-auto`.
- [x] (T5) Dado `--engine <inválido>`, quando rodo o comando, então recebo um erro que lista os engines suportados, sem rodar nada.
- [x] (T2, T7) Dado `--engine claude` sem o `claude` instalado/logado, quando rodo, então o job falha com uma mensagem dizendo o que instalar/configurar.
- [x] (T4) Dado qualquer execução, quando consulto o status, então o campo `engine` reflete o engine realmente usado.
- [x] (T6) Dado a tool `noclaf_delegate_exec` com `engine: "claude"`, quando o Cowork a chama, então a delegação usa o claude — mesma escolha do CLI.
- [x] (T1) Dado que preciso de um engine novo no futuro, quando adiciono uma entrada no registro, então nada fora do registro precisa mudar para o `exec` passar a oferecê-lo.

## Registro de decisões
- 2026-07-22: Registro central de engines em vez de `if engine == …` espalhado — o objetivo declarado é ficar fácil adicionar GLM/Kiro/etc. depois; um mapa é o ponto de extensão único.
- 2026-07-22: Default permanece **codex** — a spec 0002 do Studio saiu codex-only assumindo isso; mudar o default quebraria o que já roda.
- 2026-07-23: `parseEngine` devolve `null` no valor inválido em vez de lançar — o contrato do `exec` é stdout JSON, então o caller emite o erro no mesmo formato de todo o resto.
- 2026-07-23: candidatos de PATH vêm de um helper compartilhado (`~/.local/bin`, homebrew, `/usr/local/bin`) + extras por engine (claude tem `~/.claude/local/claude`) — evita repetir a lista por engine no registro.
- 2026-07-22: claude na execução usa `claude -p … --permission-mode acceptEdits`, reaproveitando exatamente o comando que o `runPatternsAnalysis` já valida — nada de inventar flags.

## Notas
Esta spec **destrava** o seletor de engine do noclaf Studio (a spec "E" do plano). Assim que
`--engine` existir aqui, o Studio ganha uma spec pequena que faz o seletor virar escolha real,
dependente desta. Origem: a pendência registrada nas Notas da spec 0002 do Studio.
