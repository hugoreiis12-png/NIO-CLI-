---
id: "0005"
title: Rebrand completo noclaf → nio (sem compat)
area: rebrand
status: done
created: 2026-07-26
issue:
---

# Rebrand completo noclaf → nio (sem compat)

## Problema
O projeto muda de escopo (ver `docs/ROADMAP.md`, roadmap NIO) e a marca precisa
acompanhar: nome do binário, pacote npm, diretório de dados, arquivo de binding,
prefixo de env e prefixo de PAT ainda carregam `noclaf`. Requisito do dono do
produto (crítico, não negociável): **nenhuma menção, leitura ou escrita de
qualquer artefato "noclaf" no código novo** — sem fallback, sem período de
transição.

## Solução
Reescrita de `src/brand.ts` (fonte única de marca) com os valores novos, sem
nenhuma lógica de compatibilidade com o nome antigo, seguida de uma varredura
do repo inteiro (código, testes, docs) até o grep de "noclaf" retornar vazio
fora dos pontos que documentam a própria migração.

## Histórias de usuário
1. Como usuário novo, quero instalar `@nio-cli/cli` e rodar `nio init`, para não ter nenhum resquício do nome antigo na minha experiência.
2. Como mantenedor, quero `brand.ts` como único lugar que sabe o nome da marca, para um rebrand futuro não virar caça ao literal espalhado.
3. Como dono do produto, quero grep de "noclaf" vazio no repo (fora specs/roadmap histórico), para confirmar que o requisito crítico foi cumprido.

## Escopo
- `src/brand.ts`: todos os campos (`name`, `packageName`, `mcpBinName`, `mcpServerKey`, `homeDirName`, `projectConfigFile`, `envPrefix`, `patPrefix`, `skillsRepo`, `skillsPackage`, `cliToolPrefix`, `logo`).
- `package.json`: `name`, `bin`, `description`, `keywords`, `repository`, `homepage`, `bugs`.
- Todo `src/**/*.ts` que referenciava `noclaf`/`NOCLAF` em runtime (constantes, namespaces, chaves de objeto) ou em comentário/doc.
- `README.md`, `PUBLISHING.md`.
- `bun.lock` (regerado do zero pra refletir o `name` novo do workspace).
- Extensão Cowork (`cowork-extension.ts`): manifest (`name`, `display_name`, `author`, `homepage`, `documentation`, `support`, `keywords`, env vars do `mcp_config`).

### Fora de escopo (dependências cross-sistema, não resolvidas só por este repo)
- **Domínio de auth** (`webUrl`) — decisão do dono do produto: desacoplar do
  domínio antigo; autenticação passa a ser resolvida pela própria CLI até o
  sistema interno NIO estar pronto. Mecanismo definitivo ainda em aberto — ver
  `docs/specs/auth/0002-cli-native-login.md` (draft, pergunta em aberto).
- **Prefixo do PAT** (`noc_` → `nio_`) — o backend hoje só valida `noc_`.
  `brand.patPrefix` já está em `nio_`, mas **publicar/distribuir uma versão que
  valida só `nio_` antes do backend aceitar esse prefixo quebra login de todo
  mundo**. Depender de coordenação de deploy com o backend, fora deste repo.
- **Repo de skills** (`noclaf-skills` → `nio-skills`) — refatorado por outro
  time em `github.com/hugoreiis12-png/NIO-SKILLS-` (confirmado 2026-07-26).
  `brand.skillsRepo` já aponta pra lá. Skills já provisionadas localmente em
  `.claude/skills/noclaf-flow/` (deste repo, via `sync` anterior) não foram
  tocadas — são conteúdo provisionado, não código-fonte; atualizam sozinhas
  no próximo `nio sync` assim que o repo novo publicar conteúdo.
- **Repo GitHub do próprio CLI** — projeto migrou pra
  `github.com/hugoreiis12-png/NIO-CLI` (confirmado 2026-07-26).
  `package.json`/`brand.ts` (`githubOrg`, `githubRepo`) já apontam pra lá;
  `git remote origin` deste checkout foi repontado e o trabalho empurrado
  pra lá nesta mesma rodada.
- **`productName`/`productFullName`** — mantidos como `'NOS'` (nome do produto
  gerenciado pela CLI, não da CLI em si). `productFullName` deixou de expandir
  para "Noclaf Operation System" (violaria o requisito crítico); ficou `'NOS'`
  sem expansão — pendente uma expansão real vinda do time de produto, que não
  pode reintroduzir "Noclaf".

## Restrições
- **Sem compat.** Nenhum fallback de leitura de `NOCLAF_*`, `~/.noclaf`, `noclaf.json` — decisão explícita do dono do produto, aceitando que instalações antigas não migram sozinhas.
- Toda mudança de valor de marca passa por `src/brand.ts` — nenhum literal novo hardcoded fora dele.
- `bun test` e `bunx tsc --noEmit` verdes antes de considerar a task fechada.

## Questões em aberto
- Expansão real de `productFullName` (pendente, produto).
- Timing da coordenação de backend pro `patPrefix: 'nio_'` (pendente, backend).
<!-- Resolvidas em 2026-07-26: URL do nio-skills e repo GitHub do CLI — ver Registro de decisões. -->

## Decisões de implementação
- **`toolPrefix: 'nos_'` mantido.** Nomeia o domínio do produto (NOS), não a
  marca da CLI — não é uma "menção a noclaf" no sentido do requisito. Só
  `cliToolPrefix` (`noclaf_` → `nio_`) mudou.
- **`webUrl` vira string vazia**, não um domínio novo inventado. Os dois
  pontos de uso (`cli/commands/auth.ts`, `cli/commands/init/auth-step.ts`)
  passaram a checar truthiness antes de imprimir o link, evitando uma URL
  quebrada (`/profile#mcp` sem base) enquanto o mecanismo novo não existe.
- **Constantes de path duplicadas viraram import.** `docs/_rules/noclaf.md`
  estava hardcoded em três lugares (`exec-delegate.ts`, `plan-delegate.ts`,
  `validate-plan-delegate.ts`, `cli/ui/render.ts`) além da fonte
  (`harness.ts:HARNESS_RULES_REL`). Todos passaram a importar a constante —
  reduz também o risco de um próximo rebrand esquecer um dos quatro.
- **`MANIFEST_NAME`, `SKILLS_URI_PREFIX`, `HOOKS_NS` viraram dinâmicos**
  (`` `.${brand.name}-provision.json` ``, `` `${brand.name}://skills/` ``,
  `` `hooks/${brand.name}` ``) em vez de string fixa — mesmo raciocínio.
- **`bun.lock` regerado do zero** (`rm bun.lock && bun install`) em vez de
  editado à mão, pra refletir o `name` do workspace sem risco de hash
  inconsistente. Efeito colateral aceito: algumas deps re-resolveram para
  patch/minor mais recentes dentro do range já declarado em `package.json`.

## Decisões de teste
- `src/brand.test.ts` é o teste-trava: qualquer rebrand futuro precisa
  atualizá-lo conscientemente (já era a intenção original do arquivo).
- Os demais testes que quebraram (40 em 8 arquivos) eram 100% fixtures com
  literal antigo hardcoded (nome de env var, path, mensagem de erro) — nenhuma
  lógica de produção precisou mudar além de `brand.ts`, confirmando que a
  arquitetura "fonte única" já funcionava como projetado.

## Tarefas
- [x] T1 · Reescrever `src/brand.ts` com os valores novos e as ressalvas de dependência cross-sistema documentadas em comentário.
- [x] T2 · Propagar pra `package.json`, testes de marca (`brand.test.ts`) e os dois pontos de uso de `webUrl`.
- [x] T3 · Varrer `src/**` (código + testes), `README.md`, `PUBLISHING.md`, `bun.lock` até grep de "noclaf" vazio (fora dos pontos documentados como fora de escopo).
- [x] T4 · `bun test` + `tsc --noEmit` verdes; `bun run gen:docs` rodado.

## Critérios de aceitação
- [x] (T1) `brand.ts` não importa nem referencia nada do backend antigo além do que já é infra compartilhada (`supabaseUrl`, inalterado — não é "marca noclaf").
- [x] (T3) `grep -rin "noclaf" src/ README.md PUBLISHING.md bun.lock` vazio.
- [x] (T4) `bun test` → 220 pass, 0 fail. `tsc --noEmit` → sem erros.
- [x] (T2) Rodar `nio login`/`nio init` sem PAT salvo não imprime link quebrado (checa `brand.webUrl` truthy antes).

## Registro de decisões
- 2026-07-26: Rebrand sem nenhuma camada de compatibilidade — decisão explícita do dono do produto, registrada em `docs/PLANO-EXECUCAO.md` (P0-T4). Consequência aceita: instalações antigas não migram sozinhas.
- 2026-07-26: `toolPrefix: 'nos_'` não muda — nomeia o produto (NOS) gerenciado pela CLI, não a marca da ferramenta. Distinção validada com o dono do produto antes de decidir (F11-T0).
- 2026-07-26: `patPrefix` já em `nio_` no código, mas com nota de bloqueio de deploy até o backend aceitar o prefixo novo — mudar client-side sozinho quebraria login de usuários reais.
- 2026-07-26: Conteúdo já provisionado em `.claude/skills/` (deste repo) não foi editado à mão — é saída do `nio sync`/`noclaf sync` anterior, não código-fonte; resolve sozinho no próximo sync após `nio-skills` existir.
- 2026-07-26: Repos definidos por Hugo — CLI em `hugoreiis12-png/NIO-CLI`, skills em `hugoreiis12-png/NIO-SKILLS-`. `brand.ts` ganhou `githubOrg`/`githubRepo` pra centralizar (evita reintroduzir o org antigo hardcoded em `cowork-extension.ts`, `package.json`, README, PUBLISHING).

## Notas
Consumidor primário: o próprio `docs/PLANO-EXECUCAO.md` (Fase 1, F11), que
desmembra este rebrand nas tasks F11-T0 a F11-T4. F11-T0 (as 6 perguntas de
escopo) foi respondida por Hugo em 2026-07-26 e está registrada lá.
