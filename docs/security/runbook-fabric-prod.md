# Runbook — `nio fabric` × Microsoft Entra ID em produção

**Para quem:** agente/pessoa responsável pelo ambiente de produção.
**Objetivo:** entender onde o Fabric roda, o que mudou em 2026-09-26, como colocar em produção, e o que fazer em cada erro — sem reinvestigar.
**Fontes Microsoft (lidas em 2026-09-26):** [Execute Queries](https://learn.microsoft.com/en-us/rest/api/power-bi/datasets/execute-queries) · [Service principals no Fabric](https://learn.microsoft.com/en-us/fabric/enterprise/powerbi/service-premium-service-principal) · [ROPC](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth-ropc) · [Códigos AADSTS](https://learn.microsoft.com/en-us/entra/identity-platform/reference-error-codes) · [Troubleshoot REST 401/403](https://learn.microsoft.com/en-us/power-bi/developer/embedded/troubleshoot-rest-api) · [RLS — limitações](https://learn.microsoft.com/en-us/fabric/security/service-admin-row-level-security) · [Metadata scanning](https://learn.microsoft.com/en-us/fabric/governance/metadata-scanning-overview).

---

## 1. Onde o Fabric roda (blast radius)

| Componente | Contém código Fabric? | Como chega em prod |
|---|---|---|
| `nio-gateway` (container, Portainer GitOps) | **Não** — `src/gateway/` não importa `adapters/fabric` nem lê `AZURE_*` | `image.yml` na tag `v*` → GHCR → bump em `docker/docker-compose.deploy.yml` → Portainer redeploya |
| CLI/MCP `@nio-cli/cli` (máquina do usuário) | **Sim** — tools `nio_fabric_*`, `nio fabric status`, `nio config setup` | `publish.yml` na tag `v*` → npm; usuário atualiza o pacote |

**Consequência:** um problema de Fabric nunca derruba o gateway. Ele degrada as tools `nio_fabric_*` na sessão do usuário, que recebem `errorResult` (contrato nunca-lança; sem `process.exit` na rota MCP).

**Regra de release:** sem tag `v*` não há npm nem imagem. Em 2026-09-26 faltavam tags para `release v0.14.0` e `release v0.15.1` (0.15.1 nunca foi publicada). Verifique com `git tag --points-at <hash>`.

---

## 2. O que mudou (commit `fix(fabric): endurece auth/HTTP…`, 2026-09-26)

| Antes | Agora | Efeito em prod |
|---|---|---|
| 2–3 logins no Entra por tool call (provider de token por chamada) | 1 provider por credencial no processo (`sharedTokenProvider`) | menos throttling no `/token`; com ROPC, a senha trafega uma vez por hora, não por chamada |
| 401/403 com token expirado = erro final | invalida o cache e repete **uma** vez | sessões longas não quebram na virada do token |
| 429 = "falhou", `Retry-After` ignorado | status `throttled` + "aguarde Ns" | o agente para em vez de martelar (120 req/min no `executeQueries`) |
| scanner admin sem timeout HTTP | timeout 15s/15s/60s | fim da trava dura que congelava `nio_fabric_schema_sync` |
| "token endpoint respondeu 400 …" | código `AADSTS` + ação (MFA, secret expirado, consent, tenant) | diagnóstico sem Fiddler |
| 401 em `executeQueries` genérico | cita os 3 motivos: tenant setting, Member/Build, RLS/SSO | idem |
| wizard bloqueava o save se a consulta de prova desse 401 | salva e avisa | SP que só lista/sincroniza volta a ser configurável |

**Sem dependência nova.** `tsc` limpo, 921 testes.

---

## 3. Como colocar em produção

```bash
# 1. garantir que main tem os commits (não estavam enviados em 2026-09-26)
git log --oneline origin/main..HEAD          # deve listar os fixes
git push origin main

# 2. release = tag (é o que dispara npm + GHCR)
npm version patch -m "chore(release): v%s"   # ou minor
git push origin main --tags

# 3. conferir os workflows
gh run list --workflow publish.yml -L 1
gh run list --workflow image.yml -L 1        # faz o bump no docker-compose.deploy.yml
npm view @nio-cli/cli version
```

O gateway **não precisa** de redeploy por causa deste change (não o toca), mas o `image.yml` vai gerar imagem e bump mesmo assim — é o comportamento normal da tag.

---

## 4. Pré-requisitos no tenant (checklist — Fabric Admin Portal + Entra)

Sem isto, nenhum código resolve. Anote quem é o admin do tenant.

### Service principal (recomendado pela Microsoft para automação)
- [ ] Entra → App registrations → o app existe; `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` são os GUIDs dele
- [ ] Certificates & secrets → secret **válido** (máx. 24 meses; rotacione a cada ≤ 6 meses; anote a data de expiração num calendário — a falha é silenciosa: `AADSTS7000222`)
- [ ] API permissions: **só Application** (não misture com Delegated no mesmo app)
- [ ] Fabric Admin → Tenant settings → Developer settings → **"Service principals can call Fabric public APIs"** = Enabled, com o SP no security group aplicado
- [ ] Tenant settings → Integration settings → **"Dataset Execute Queries REST API"** = Enabled
- [ ] Workspace → Manage access → o SP é **Member** ou **Admin** (Viewer não dá Build)
- [ ] O dataset-alvo **não tem RLS nem SSO** — se tiver, SP **não executa DAX** (limitação Microsoft, não do nio). Ele ainda lista e sincroniza schema.
- [ ] (Só para `nio_fabric_schema_sync` com fórmulas) Tenant settings → Admin API settings → **"Service principals can access read-only admin APIs"** + **"Enhance admin APIs responses with detailed metadata"** + **"…with DAX and mashup expressions"**; e o app **sem** permissões admin-consent de Power BI

### Token de usuário (ROPC) — só quando o dataset tem RLS
- [ ] A conta **não** está sob MFA/Conditional Access (senão `AADSTS50076/53003`; a Microsoft recomenda contra ROPC)
- [ ] Conta não é convidada, não é federada (AD FS), tem senha, senha sem espaço nas bordas
- [ ] API permissions: **Delegated** (Power BI Service → `Dataset.Read.All`) com consentimento
- [ ] A conta tem Build no dataset (Viewer com Build basta; RLS será aplicado)

---

## 5. Onde as credenciais vivem

| Lugar | O quê | Observação |
|---|---|---|
| `~/.nio/config.env` (chmod 600) | `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `NIO_FABRIC_USERNAME/PASSWORD`, `NIO_FABRIC_WORKSPACE/DATASET` | escrito por `nio config setup`; **único** lugar suportado |
| `./.env` do projeto | **não** carrega `AZURE_*` (allowlist) | não tente colocar aqui |
| git | nunca teve valor real (verificado `git log -p -S`) | manter assim |
| Memória do processo | token em cache até `expires_in − 60s` | nunca vai a disco nem a log |

Rotação de secret: gere o novo no Entra → `nio config setup` (ou edite `config.env`) → `nio fabric status`. O provider é chaveado pela credencial, então um processo MCP já aberto passa a usar o novo secret na próxima chamada só se for reiniciado; sessões novas pegam na hora.

---

## 6. Diagnóstico — mensagem → ação

Rode primeiro: `nio fabric status --json` (preflight: token + `GET /groups`) e `nio config check`.

| Mensagem (trecho) | Significa | Ação |
|---|---|---|
| `Fabric não configurado` | falta `AZURE_TENANT_ID/CLIENT_ID` ou o par de credencial | `nio config setup` |
| `(AADSTS50076)` / `50079` / `53003` — "exige MFA/Conditional Access" | conta ROPC sob MFA | trocar para service principal, ou pedir exceção de CA ao admin |
| `(AADSTS7000222)` — "client secret EXPIRADO" | secret venceu | gerar novo secret; atualizar `AZURE_CLIENT_SECRET` |
| `(AADSTS7000215)` — "secret inválido" | colou o Secret ID em vez do Value, ou secret errado | copiar o **Value** |
| `(AADSTS50126)` | usuário/senha errados | corrigir `NIO_FABRIC_USERNAME/PASSWORD` |
| `(AADSTS50053)` — "bloqueada por tentativas" | smart lockout | esperar; não repetir; ver se algo automatizou tentativas |
| `(AADSTS65001)` / `90094` — "sem consentimento" | permissões do app sem admin consent | Entra → API permissions → Grant admin consent |
| `(AADSTS700016)` / `90002` — "tenant ou client id errado" | GUID errado | conferir os dois GUIDs |
| `token endpoint limitou (429) — aguarde Ns` | throttling no Entra | esperar N s; se recorrente, algo cria providers demais (regressão do singleton) |
| `Power BI respondeu 401 … confira: (1) tenant setting … (2) Member/Admin … (3) RLS/SSO` em **executeQueries** | um dos 3 checks da §4 | seguir a lista; se `nio fabric status` lista workspaces mas a consulta dá 401 → é (2) ou (3) |
| `Power BI respondeu 401/403` em **listWorkspaces** | setting de APIs públicas ou SP fora do security group | §4, primeiro bloco |
| `getInfo respondeu 401 … read-only admin APIs` | setting **da API admin** (é outro) | §4, último item do bloco SP |
| `o locatário bloqueia os metadados (…DisabledByAdmin)` | metadados detalhados desligados | ligar os dois toggles de Admin API settings |
| `Power BI limitou as chamadas (429) — aguarde Ns` | 120 req/min por identidade | esperar; reduzir chamadas do agente (agregar no DAX) |
| `Fabric indisponível (rede/timeout)` | timeout (10s token / 15s listagem / 60s DAX e scanResult) ou DNS/proxy | rede de saída para `login.microsoftonline.com` e `api.powerbi.com`; DAX pesado → simplificar |
| `Power BI respondeu 400: <detalhe do DAX>` | erro de DAX | é do modelo/consulta, não de credencial |

Se a mensagem não bate com nenhuma linha: `NIO_DEBUG=1 nio fabric status` e abrir issue com o `AADSTS`/`code` do Power BI (nunca com o token).

---

## 7. Incidentes — o que fazer e o que NÃO fazer

| Sintoma em prod | Faça | Não faça |
|---|---|---|
| Vários usuários com `AADSTS7000222` no mesmo dia | rotacionar o secret (§5) e comunicar | não "estender" o secret antigo — não existe; não colocar o secret no `.env` do repo |
| `429` em rajada durante sessão de IA | deixar o agente esperar; revisar prompts que iteram DAX | não adicionar retry automático no adapter — é exatamente o que a Microsoft pede para não fazer |
| `nio_fabric_schema_sync` demorando > 2 min | agora aborta sozinho (timeouts); ver `disabled`/`throttled` na resposta | não subir `POLL_MAX` sem medir |
| Admin ligou MFA para a conta ROPC | migrar para SP (se dataset sem RLS) ou pedir exceção de CA para a conta técnica | não tentar contornar MFA |
| Alguém pede para "guardar o token" | recusar — token vive só em memória por design | — |

---

## 8. Verificação rápida pós-deploy

```bash
nio --version                       # esperado ≥ versão da tag
nio config check                    # Fabric — service principal | token de usuário
nio fabric status --json            # {"configured":true,"status":"ok","workspaceCount":N}
# dentro de uma sessão: nio_fabric_workspaces → nio_fabric_datasets → nio_fabric_query "EVALUATE ROW(\"x\",1)"
```

Testes locais do subsistema: `bun test src/adapters/fabric src/lib/auth/fabric-config.test.ts src/tools/fabric-*.test.ts`.

---

## 9. Pendências conhecidas (decisões humanas)

1. **Push + tag** dos commits de 2026-09-26 (§3).
2. **Default do wizard é ROPC** (`fabric-config.ts` `GRANT_CHOICES`) — a Microsoft recomenda contra; hoje só avisa. Decidir se volta para SP como default.
3. **Tags faltantes** `v0.14.0`, `v0.15.1` — criar retroativas ou registrar como puladas.
4. **ADR** de autenticação Fabric em `docs/adr/` (grants, tenant settings por endpoint, limites) — hoje só existe a auditoria.
5. `unauthorized` ainda vira `unavailable` em `src/app/dax-rag.ts:92` (o texto da mensagem preserva a causa).
