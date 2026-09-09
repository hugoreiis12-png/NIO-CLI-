# Segurança — NIO-CLI

Pasta de rastreio da auditoria de segurança e do trabalho que ela gerou.

| Arquivo | O quê |
|---------|-------|
| [`security-audit-2026-09.md`](security-audit-2026-09.md) | Auditoria original (2026-09) — modelo de ameaça, achados detalhados, roadmap. **Fonte da razão de cada item.** |
| [`implemented.md`](implemented.md) | O que **já foi feito** — mudanças de código, arquivo por arquivo, com testes. |
| [`ops-actions.md`](ops-actions.md) | O que precisa ser feito **do lado do time / infra** — não é código: rotação de segredo, CA do banco, hardening do GitHub. |
| [`backlog.md`](backlog.md) | O que **ainda falta implementar** — Médios, Baixos, itens de versionamento, e a melhoria futura de cripto de senha. |
| [`dev-tasks.md`](dev-tasks.md) | Board dos lotes de dev (o que já entrou, o que falta). |
| [`task-user-lote3.md`](task-user-lote3.md) | Task de infra (Kong admin + rede) — ✅ validado em dev. |
| [`task-user-lote4.md`](task-user-lote4.md) | Task no repo `NIO-SKILLS-` — publicar `nio-skills.json` (`min_cli_version`). |
| [`i1-i2-analysis.md`](i1-i2-analysis.md) | Análise dos informativos I-1 (npm público) e I-2 (`ips_using` morto) + recomendações. |
| [`task-user-i1-registry.md`](task-user-i1-registry.md) | Task: criar a org `nio-cli` + GitHub Packages (I-1 + metade do H-3). |
| [`i2-login-por-ip.md`](i2-login-por-ip.md) | I-2 vira feature — perguntas de design de login por IP. |
| [`sp1-trilha-auth.md`](sp1-trilha-auth.md) | SP-1 — análise que originou a ADR 0012. |
| [`../adr/0012-trilha-auth-persistente.md`](../adr/0012-trilha-auth-persistente.md) | **ADR 0012** — trilha de auth persistente (`auth_events`). ✅ feito. |
| [`third-pass.md`](third-pass.md) | **Terceira passada** — TP-1 a TP-6 ✅ implementados (2026-09-07). Só o TP-1 tem passo de ops. |
| [`../adr/0011-endurecimento-cripto-auth.md`](../adr/0011-endurecimento-cripto-auth.md) | **ADR 0011** — a arquitetura do Lote 5 que vamos seguir (decisões fechadas, plano em 3 fases). |
| [`lote5-cripto-arquitetura.md`](lote5-cripto-arquitetura.md) | Doc de trabalho que originou a ADR 0011 (o raciocínio). |
| [`db-tls.md`](db-tls.md) | Runbook da CA interna do Postgres (fecha o H-2 na infra self-hosted). |

## Status geral (2026-09-07)

> **Backlog dev-doable = zero.** Todo código (Altos, Médios, Baixos, §4, Lote 5
> A–F, ADR 0012, SP-1..7, TP-1..6) está commitado e verde no CI. O que resta é só
> infra/conta de prod: rotação do `JWT_SECRET` (H-1), CA do Postgres (H-2), org
> GitHub + branch protection (H-3/I-1), `db:migrate --baseline` em prod (I-3),
> LOGIN users `nio_cli_user`/`nio_gw_user` em prod (TP-1), `nio-skills.json` no
> repo de skills (§4.1). §4.4 adiado (YAGNI).


| ID | Sev | Título | Código | Ação do time | Estado |
|----|-----|--------|:------:|:------------:|--------|
| H-1 | Alta | `JWT_SECRET` sem exigência de força | ✅ feito | ⏳ rotacionar em prod | **código pronto, pendente ops** |
| H-2 | Alta | Postgres TLS sem verificação de cert | ✅ feito | ⏳ gerar/distribuir CA | **código pronto, pendente ops** |
| H-3 | Alta | Supply chain das skills sem pin | ✅ feito | ⏳ org + branch protection + bump por release | **código pronto, pendente ops** |
| H-4 | Alta | `adm-zip <0.6` + teto de download + transitivas | ✅ feito | — | **fechado** — `bun update` + `overrides`; `bun audit` limpo (0 vulns) |
| M-1 | Média | MCP usa `session.json.name` em vez do `userId` do token | ✅ feito | — | **código pronto** |
| M-2 | Média | Sem lockfile no build da imagem | ✅ feito | — | **código pronto** (all-bun, Dockerfile multi-stage) |
| M-3 | Média | 1º fator sem lockout na aplicação | ✅ feito | — | **código pronto** (atraso escalonado in-memory) |
| M-4 | Média | `/security/enable-2fa` → WhatsApp pra número arbitrário | ✅ feito | — | **código pronto** (cap in-memory 3/15min + 1/60s) |
| M-5 | Média | Enumeração de usuário por timing | ✅ feito | — | **código pronto** |
| M-6 | Média | `.env` do cwd carregado sem filtro | ✅ feito | — | **código pronto** |
| M-7 | Média | Kong Admin API sem auth | ✅ feito | validado em dev (login pelo Kong OK) | **fechado** (dev + deploy) |
| M-8 | Média | `docker.sock` em portainer + mcp-gateway | ✅ feito | validado em dev (stack sobe, login OK) | **fechado** — rede `nio-infra` + socket-proxy GET-only; mcp-gateway = opt-in |
| L-1 | Baixa | `openUrl` Windows `cmd /c start` | ✅ feito | — | **código pronto** |
| L-2 | Baixa | Código de backup sem cap de tentativas por desafio | ✅ feito | — | **código pronto** |
| L-3 | Baixa | Handler de erro do gateway vaza `err.message` | ✅ feito | — | **código pronto** |
| L-4 | Baixa | Segredo: `writeFile` → `chmod` (janela 0644) | ✅ feito | — | **código pronto** |
| L-5 | Baixa | `handleLogout` sem checagem de dono | ✅ feito | força re-login (com H-1) | **código pronto** |
| L-6 | Baixa | JWT sem `iss`/`aud` | ✅ feito | força re-login (com H-1) | **código pronto** |
| I-1 | Info | Código `UNLICENSED` publicado público no npm | ⏳ config staged | ⏳ **você** — criar org `nio-cli` + mover repos | [task-user-i1-registry.md](task-user-i1-registry.md) |
| I-2 | Info | `ips_using` — campo morto | ✅ feito | migration `0006` em prod | virou feature "login por IP" — auditoria de IP (`login_ip_events`), sem enforcement. ADR 0011 §F. |
| I-3 | Info | base image sem digest / sem runner de migração | ✅ feito | rodar `db:migrate --baseline` em prod | **código pronto** (digest pinado + `scripts/migrate.ts`) |
| §4.6 | Vers. | nomes de tool MCP sem trava | ✅ feito | — | snapshot test |
| §4.2 | Vers. | SDK vs binário `opencode` (skew) | ✅ feito | — | aviso no boot do `nio ai` |
| §4.1 | Vers. | CLI ↔ bundle de skills sem contrato | ✅ feito | ⏳ **você** — `nio-skills.json` no repo | task-user-lote4.md |
| §4.3 | Vers. | `JWT_SECRET` 3 papéis, sem rotação | ✅ feito | — | Lote 5: `OTP_HMAC_SECRET` (F1 D) + `JWT_SECRETS`/`kid` (F2 E) |
| §4.4 | Vers. | gateway ↔ CLI sem header de protocolo | ⏸️ adiado | — | YAGNI — reabre se a API crescer |
| §4.5 | Vers. | migrations sem runner | ✅ feito | — | = I-3 (`scripts/migrate.ts`) |
| SP-1 | 2ª pass | Trilha de auth só em stderr (sem histórico) | ✅ feito | — | `auth_events` (ADR 0012) |
| SP-2 | 2ª pass | `sub` do token não conferido vs dono da sessão | ✅ feito | — | `middleware/auth.ts` |
| SP-3 | 2ª pass | `MIN_PASSWORD_LENGTH` só no CLI | ✅ feito | — | enforçado no gateway |
| SP-4 | 2ª pass | Transitivas vulneráveis (`fast-uri`/`hono`/`qs`) | ✅ feito | — | `overrides` — `bun audit` limpo |
| SP-5 | 2ª pass | Sem teto de sessões / sem `logout --all` | ✅ feito | — | `MAX_SESSIONS_PER_USER` + `POST /logout-all` + `nio logout --all` |
| SP-7 | 2ª pass | Senha só validada por tamanho | ✅ feito | — | `breach-check.ts` — lista local + HIBP (fail-open) |
| SP-6 | 2ª pass | Update-notifier proativo | ✅ já existia | — | `notifyCliIfUpdate` (`cli.ts`) |
| TP-1 | 3ª pass | CLI com credencial de escrita nas tabelas de auth | ✅ feito | ⏳ criar LOGIN users em prod | migration `0008` (roles) + `register` no gateway |
| TP-2 | 3ª pass | Sem fluxo de troca de senha | ✅ feito | — | `nio security change-password` (revoga sessões) |
| TP-3 | 3ª pass | Enumeração de usuário no `register` | ✅ feito | — | decoy de timing |
| TP-4 | 3ª pass | Zip com symlink na extração | ✅ feito | — | `rejectSymlinks()` |
| TP-5 | 3ª pass | Retenção negativa apaga a tabela | ✅ feito | — | clamp `Math.max(1,…)` |
| TP-6 | 3ª pass | `trace_id` do cliente sem cap | ✅ feito | — | `.slice(0, 64)` |

Legenda: ✅ feito · ⏳ pendente · ⏸️ adiado · ⬜ não iniciado.

## Dev vs. prod

**Estamos em dev.** Quase tudo é trabalho de dev (código + teste local, entra no
próximo release). Só 4 itens exigem um toque coordenado em **prod** — e mesmo
esses dá pra preparar daqui.

### Faz 100% em dev, agora

| Item | O quê |
|------|-------|
| ✅ M-1, M-5, M-6, L-1…L-6 | **feitos** (Lote 1 — ver [`dev-tasks.md`](dev-tasks.md)) |
| M-3, M-4 | rate limiting — precisa decisão (in-memory vs tabela) |
| I-2 | fix pequeno — depende do runner de migração |
| M-2 | decidir gerenciador + commitar lockfile |
| H-4 (resto) | `npm audit fix` das transitivas |
| §4.1/4.2/4.4/4.6 | contratos de versão, snapshot de tools MCP, check do binário opencode |
| Cripto de senha (fase futura) | código + ADR + testes |
| M-7, M-8, I-3 (base image) | editar `docker/*.yml` / `Dockerfile.gateway` e validar com `docker compose up` local |
| **H-1 (dev)** | rotacionar o `JWT_SECRET` do teu `.env` local (provável que seja fraco) — só re-login local, risco zero |
| **H-2 (dev)** | **tirar `NIO_DATABASE_SSL=true` do `.env` local** (Postgres local não tem TLS) → conserta os 2 testes de integração que falham |
| H-3 (bump) | trocar o SHA em `brand.skillsRef` a cada release — é edição de código |

### Exige ação em prod (agendar — não basta dar merge)

| Item | Ação de prod | Dá pra preparar em dev? |
|------|--------------|------------------------|
| **H-1** | rotacionar o `JWT_SECRET` em todos os hosts/containers do gateway de prod + forçar re-login do time | sim — gerar o segredo, escrever o passo a passo (já está em `ops-actions.md`) |
| **H-2** | CA real: emitir server cert pro Postgres de **prod**, ligar `ssl=on`, distribuir a `ca.crt` pro gateway de prod + máquinas do time + PgAdmin/DBeaver | sim — `bun run db:tls` gera tudo; testar o fluxo contra um Postgres de teste |
| **H-3** | mover `NIO-SKILLS-` pra uma **org** do GitHub, branch protection no `main`, exigir 2FA | não — é config no GitHub (admin da org) |
| **I-3** (migrations) | rodar o runner de migração contra o Postgres de **prod** | sim — escrever o runner + a tabela de controle em dev |
| **I-1** | decisão de registry (privado vs público) + republicar | não — decisão de produto/conta |

**Resumo:** hoje, em dev, dá pra fechar todo o código (H-4 resto, M-*, L-*, §4,
cripto de senha) e preparar os artefatos dos 4 itens de prod. O que trava em prod
é só: rotação do segredo, deploy da CA, config do GitHub, e rodar migração.
