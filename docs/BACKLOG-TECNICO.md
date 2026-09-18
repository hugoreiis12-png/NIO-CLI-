# Backlog técnico — NIO-CLI

> Gerado a partir da análise técnica completa do repositório em 2026-09-17/18 (arquitetura, banco de dados, segurança, qualidade de código). Cada item tem origem verificada em código/schema real — não é opinião genérica. Atualize este arquivo conforme os itens forem resolvidos (mova para "Resolvido" com data e commit).

## Como usar

- **Severidade** segue a mesma escala da análise: CRÍTICO / ALTO / MÉDIO / BAIXO / INFO.
- **Evidência** aponta caminho:linha ou comando que confirma o achado — reverifique antes de agir, pode ter mudado desde a análise.
- Itens marcados **[decisão]** não têm resposta técnica única — exigem uma escolha do time antes de codar.

---

## 1. Harness / documentação

### 1.1 `docs/_patterns.md` ausente — referência quebrada no `AGENTS.md` [MÉDIO]
`AGENTS.md` importa `@docs/_patterns.md` como parte do harness ("Componentize/modularize sempre", regras de DRY/YAGNI citadas na doutrina do harness), mas o arquivo não existe no repo (`ls docs/_patterns.md` → No such file or directory). Metade do harness declarado não carrega.
**Ação**: confirmar se foi removido por engano (checar `git log --all -- docs/_patterns.md`) ou nunca foi commitado; recriar ou remover a referência do `AGENTS.md`.

### 1.2 `docs/arch/ARQUITETURA-GATEWAY.md` desatualizado [BAIXO]
Descreve `src/gateway/server.ts` com `Bun.serve` na porta 8787 como scaffold sem lógica. Isso não existe mais — a implementação real é `src/gateway/index.ts` (391 linhas, `node:http`), já completa com `services/{login,register,security}.ts`.
**Ação**: reescrever a seção para refletir o estado atual.

### 1.3 `docs/security/README.md` referencia arquivos inexistentes [MÉDIO]
Cita 15+ documentos (ADR 0011, ADR 0012, `implemented.md`, `backlog.md`, `ops-actions.md`, `sp1-trilha-auth.md`) que não existem no working tree nem no histórico git. Commit `3e8f9b3` apagou os ADRs 0002-0010 na mesma leva que reescreveu o README.
**Ação [decisão]**: recriar a trilha de decisão a partir do que ainda é verificável no código, ou remover as referências mortas do README.

---

## 2. Arquitetura

### 2.1 Invariante do `SessionManager` furado em 7 pontos [MÉDIO]
`session-manager.ts:1-6` declara ser "o ponto ÚNICO" de acesso a sessão para CLI e MCP tools. Na prática, 7 arquivos importam `createSessionRepository` direto, pulando essa camada:
- `src/cli/commands/open.ts:5`
- `src/cli/commands/debug.ts:6`
- `src/cli/commands/docker.ts:35`
- `src/cli/commands/ai.ts:10`
- `src/cli/commands/deps.ts:6`
- `src/cli/flows/onboarding.ts:12`
- `src/tui/launch.tsx:13`

**Risco**: qualquer regra nova adicionada ao `SessionManager` (ex. validação de status antes de ler sessão) não se propaga a esses 7 pontos.
**Ação [decisão]**: migrar os 7 imports para passar pelo `SessionManager`, ou remover o invariante documentado se o acesso direto for intencional.

### 2.2 Arquivos acima de 300 linhas (regra do harness) [MÉDIO — priorizar `state.ts`]

| Arquivo | Linhas |
|---|---|
| `src/tui/state.ts` | **665** |
| `src/cli/commands/docker.ts` | 612 |
| `src/tui/components.tsx` | 551 |
| `src/lib/clients/client-configs.ts` | 522 |
| `src/tui/app.tsx` | 445 |
| `src/tui/app.test.tsx` | 393 |
| `src/gateway/index.ts` | 391 |
| `src/cli/commands/sync.ts` | 377 |
| `src/config.ts` | 343 |
| `src/tui/state.test.ts` | 339 |
| `src/lib/auth/nio-config.ts` | 331 |
| `src/cli/commands/docs/content.ts` | 308 |
| `src/adapters/pg/client.ts` | 304 |

**Ação**: quebrar por responsabilidade, começando por `state.ts` (mais que o dobro do limite).

### 2.3 Verticalização por camada técnica, não por domínio [INFO]
`src/` no nível 1 é organizado por camada técnica (`cli/`, `app/`, `adapters/`, `core/`, `gateway/`, `tools/`, `tui/`), o que diverge da letra da regra "verticalização por domínio/feature" do harness de back-end. Aceitável para um CLI de ferramenta única, mas registrar como divergência conhecida.
**Ação**: nenhuma urgente — reavaliar se o projeto crescer para múltiplos domínios de negócio.

---

## 3. Banco de dados

### 3.1 `log_session` e `session_activity` sem repository [MÉDIO]
Tabelas existem no schema com GRANTs dedicados e tipos de domínio em `src/core/types.ts:106-127`, mas nenhum adapter em `src/adapters/pg/` as lê ou escreve. Feature especificada, nunca conectada ao código.
**Ação [decisão]**: implementar os repositories, ou remover as tabelas/tipos se a feature foi abandonada.

### 3.2 Listagens sem paginação [BAIXO]
`session-repository.ts` (`listByUser`) e `auth-session-repository.ts` (`listActiveByUser`) não têm `LIMIT` — viola a regra "listagem sempre paginada". Risco prático baixo hoje (escopo é sempre 1 usuário), mas sem teto.
**Ação**: adicionar `LIMIT`/paginação por padrão.

### 3.3 Escrita multi-passo fora de transação em `issueSession` [BAIXO]
`src/gateway/services/login.ts:127-133` faz 3 escritas separadas (`touchLastSession`, `sessions.create`, `pruneExcessSessions`→`revoke`) sem transação. Cada write é independentemente não-crítica, mas viola a regra literal.
**Ação**: envolver em `withTransaction`, ou documentar por que a atomicidade não é necessária aqui.

### 3.4 `user_cli.ips_using` como TEXT em vez de JSONB [INFO]
Reservado para allowlist futuro (comentário da migration 0006). Aceitável hoje via YAGNI, mas sem índice se o uso crescer.
**Ação**: nenhuma agora — revisar se a feature de allowlist for implementada.

---

## 4. Segurança / infraestrutura

### 4.1 TLS ausente entre Kong e cliente no deploy LAN [ALTO — infra, não código]
`docker/docker-compose.deploy.yml` expõe `KONG_PROXY_LISTEN: "0.0.0.0:8000"` sem `ssl`. JWT, senha e OTP trafegam em claro na LAN do deploy.
**Ação [decisão]**: adicionar TLS no Kong (cert self-signed + distribuição de CA), ou documentar explicitamente "LAN confiável, TLS fora de escopo" como decisão aceita.

### 4.2 Postgres TLS com verificação de certificado desligada no deploy [ALTO — já rastreado]
`NIO_DATABASE_SSL:-false` em `docker-compose.deploy.yml:77`. Já existe tooling pronto (`scripts/db-tls-setup.sh`, CA interna) — falta rodar em produção. Consistente com o gotcha já registrado (SSL local) e com a auditoria de segurança de set/2026 (H-2).
**Ação**: aplicar o TLS em produção usando o tooling já existente.

---

## 5. Qualidade de código

### 5.1 2 `catch {}` vazios em JS embutido [BAIXO]
`src/cli/commands/docs/html.ts:85,90` — dentro de string HTML estática, para tema claro/escuro via `localStorage`. Risco desprezível (client-side, sem dado sensível), mas é violação literal da regra "trate ou propague".
**Ação**: baixa prioridade — envolver em log mínimo se for mexer no arquivo por outro motivo.

### 5.2 1 teste falhando por drift de ambiente [INFO — não é bug]
`src/gateway/services/login.integration.test.ts` falha localmente porque a migration 0009 (canal `whatsapp`) não foi aplicada no Postgres de teste local — mesmo gotcha já conhecido de SSL/config local.
**Ação**: rodar `bun run db:migrate` no ambiente de teste local antes de rodar a suíte.

---

## Itens sem ação necessária (verificados como corretos, registrados para não re-auditar)

- Tipagem: zero `any` em produção, zero supressões de lint/type, `tsc --noEmit` limpo.
- Hashing de senha (argon2id), pepper, JWT (HS256 travado, `jti`=session real, revogação funcional), OTP, backup codes, breach-check (HIBP k-anonymity) — todos verificados como sólidos.
- Nenhum segredo hardcoded, `.env` no `.gitignore`.
- `dist/` corretamente fora do controle de versão.
- Nenhuma API exclusiva do Bun em `src/` — compatibilidade Node >=20 real, não só declarada.
- Duplicação em `src/profiles/*` é dado tabular legítimo, não código repetido.
