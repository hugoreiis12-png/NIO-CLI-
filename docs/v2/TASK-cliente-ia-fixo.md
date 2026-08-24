# Tarefa — Travar modelo + handoff de terminal pro operador fixo (OpenCode/big-pickle)

> Para o agente que pegar esta tarefa: leia `docs/v2/ARQUITETURA-CLIENTE-IA.md`
> inteiro antes de tocar em código — ele explica o "porquê" e as limitações
> reais (o lock de modelo é soft, não hard). Execução **cirúrgica e
> incremental**: `bunx tsc --noEmit` limpo e `bun test` verde a cada passo.

## Contexto

Diferente da `TASK-remocao-v1.md`, aqui a maior parte da base **já existe**
(decisão de 27 jul 2026 restringiu tudo a OpenCode). Isto não é construir do
zero — é fechar 3 lacunas concretas + 1 bug + limpeza opcional.

## Tarefa 1 — Corrigir `KNOWN_CLIENTS` (bug, faça primeiro, é isolado e seguro)

`src/lib/skills.ts`:
```diff
-export const KNOWN_CLIENTS = ['claude-code', 'codex', 'cowork'] as const;
+export const KNOWN_CLIENTS = ['claude-code', 'codex', 'cowork', 'opencode'] as const;
```
Verificação: `bunx tsc --noEmit` + `bun test` (há testes de `parseClients`/
`filterSkillsForSurface` que devem continuar passando).

## Tarefa 2 — Travar o modelo em `opencode.json`

Em `src/lib/client-configs.ts`, a função `installOpencodeGlobal()` (e a pura
`planOpencodeUpdate()` que ela chama) precisam passar a escrever a chave
`model` no nível raiz do JSON, junto de `mcp`:

```json
{
  "model": "opencode/big-pickle",
  "mcp": { "nio": { "type": "local", "command": [...], "environment": {...}, "enabled": true } }
}
```

Cuidado: `planOpencodeUpdate()` é pura e só mexe em `mcp` hoje — precisa
also preservar/definir `model` sem apagar outras chaves do usuário
(`existing`). Siga o mesmo padrão defensivo que já existe pra `mcp`
(spread do `existing`, não sobrescrever o objeto inteiro). Adicione ao teste
existente do `client-configs` um caso cobrindo isso: `model` ausente →
grava; `model` já é outro valor → decidir se sobrescreve (recomendo
sobrescrever, é a decisão de produto: sempre `big-pickle`) ou avisa — bata
essa decisão com o dono do projeto se não estiver óbvio no momento.

**Não esqueça**: isto é um *default*, não um lock (ver "Decisões e
limitações reais" na arquitetura). Não escreva comentário nem mensagem de
usuário que prometa "modelo travado" sem qualificar que é o default.

## Tarefa 3 — `nio init` termina com handoff pro `opencode` (a peça nova principal)

Hoje `runInitWizard()` (`src/cli/commands/init/index.ts`) termina em
`offerFollowUps()` e devolve o prompt do shell. Precisa passar a:

1. Mostrar o logo (`renderMatrixLogo()`, já existe, usado em outros
   comandos) + uma frase curta de contexto — **antes** do resto do wizard
   rodar, não só no fim. Ver "Questões em aberto" da arquitetura sobre o
   que exatamente esse "help" deve conter; na dúvida, comece com algo
   mínimo (nome do produto + 1 frase) e ajuste depois — não trave a tarefa
   nisso.
2. No fim de `offerFollowUps()`, fazer o handoff de terminal:
   ```ts
   import { spawn } from 'node:child_process';
   // ...
   const child = spawn('opencode', [], { stdio: 'inherit' });
   await new Promise<void>((resolve) => child.on('exit', () => resolve()));
   ```
   `stdio: 'inherit'` é o ponto crítico — é isso que entrega o terminal de
   verdade pro `opencode` (diferente do padrão usado em
   `lib/exec-delegate.ts`, que captura stdout pra parsear resultado; aqui
   não tem o que parsear, é sessão interativa).
3. Resolver o binário do jeito que o resto do projeto já faz — olhe
   `lib/client-install.ts`/`isBinaryInstalled` (usado por
   `ensureClientInstalled`) em vez de reinventar a busca de PATH.
4. Se o `opencode` não estiver instalado (não deveria chegar aqui, já que
   `ensureCoreClients` roda antes — mas trate o caso defensivamente):
   mensagem clara, não trace de erro cru.

## Tarefa 4 (opcional, avaliar com o dono do projeto antes) — Simplificar o checkbox de cliente

`promptClientChoices()` (`clients-step.ts`) hoje pergunta com um checkbox
que só tem UMA opção possível ("OpenCode (global)"). Considerar remover a
pergunta e configurar automaticamente, com uma linha informativa em vez de
prompt. **Não é bloqueante** pras Tarefas 1-3 — é polish de UX. Só faça se
sobrar tempo/escopo.

## Como verificar

```bash
bunx tsc --noEmit
bun test

# Smoke manual (não dá pra automatizar handoff de terminal em bun test):
rm -f ~/.config/opencode/opencode.json   # ambiente limpo
cd /tmp && mkdir nio-init-smoke && cd nio-init-smoke
nio init
# Esperado: logo aparece, wizard roda, e ao final o terminal vira a sessão
# do opencode (prompt muda pro do opencode, não volta pro shell).
cat ~/.config/opencode/opencode.json   # confirma model: "opencode/big-pickle" + mcp.nio
```

## Riscos conhecidos

- **Lock de modelo é só default** — repetir aqui porque é fácil esquecer no
  meio da implementação e prometer no texto de UI algo que o código não
  garante.
- **Autenticação do `big-pickle`** ainda não está mapeada (ver "Questões em
  aberto" da arquitetura) — se `opencode` precisar de credencial e o
  usuário não tiver, o handoff da Tarefa 3 vai jogar o usuário numa sessão
  que não funciona. Vale um check antes do `spawn` (mesmo que só um aviso,
  não um bloqueio) — decidir escopo com o dono do projeto se a solução
  completa (fluxo de auth do OpenCode) for maior que cabe aqui.
- Este documento reflete o código em 24 ago 2026 (branch `main`, após o
  commit `72c365f`). Confira `src/lib/targets.ts`/`client-configs.ts` de
  novo antes de seguir cegamente — mesma ressalva de sempre.
