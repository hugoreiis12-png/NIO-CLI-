# Diagramas NIO-CLI

## 1. Módulos
6 módulos detectados pela doc-pipeline.

[🎨 Editar](https://l.mermaid.ai/7TTYRv)

```mermaid
flowchart TD
    mod_adapters["adapters"]
    mod_cli["cli"]
    mod_core["core"]
    mod_gateway["gateway"]
    mod_lib["lib"]
    mod_tools["tools"]
    style mod_adapters fill:#3498db,color:#fff
    style mod_cli fill:#2ecc71,color:#fff
    style mod_core fill:#9b59b6,color:#fff
    style mod_gateway fill:#e67e22,color:#fff
    style mod_lib fill:#e74c3c,color:#fff
    style mod_tools fill:#f1c40f,color:#fff
```

---

## 2. Arquitetura Hexagonal
Entry Points → Core Layer → Adapters.

[🎨 Editar](https://l.mermaid.ai/WaqVJS)

```mermaid
flowchart TB
    subgraph EntryPoints["ENTRY POINTS"]
        CLI["src/cli.ts<br/>Commander CLI"]
        MCP["src/mcp-server.ts<br/>MCP Server (stdio)"]
        GW["src/gateway/server.ts<br/>Auth Gateway (Bun.serve)"]
    end

    subgraph Core["CORE LAYER"]
        PORTS["src/core/ports.ts<br/>5 Gateway interfaces"]
        TYPES["src/core/types.ts"]
        CONFIG["src/config.ts"]
        AUTH["src/auth.ts"]
        SESSION["src/session-factory.ts"]
        BRAND["src/brand.ts"]
    end

    subgraph Adapters["ADAPTERS"]
        SUPA["adapters/supabase/<br/>PostgREST"]
        PG["adapters/postgres/<br/>Dual-IP Bun.sql"]
    end

    CLI -->|"commander"| Core
    MCP -->|"MCP stdio"| Core
    GW -.->|"OAuth2 PKCE"| Core
    Core -->|"session-factory"| SUPA
    Core -.->|"investigation"| PG
```

---

## 3. Inicialização do MCP Server
Ciclo de vida do servidor stdio.

[🎨 Editar](https://l.mermaid.ai/h8Yosm)

```mermaid
flowchart LR
    START(["mcp-server.ts start"]) --> LOAD_CONFIG["loadConfigStep()"]
    LOAD_CONFIG --> SKILLS_CACHE["initSkillsCache()<br/>(~/.nio/skills)"]
    SKILLS_CACHE --> AUTH_SESSION["authenticateSession()<br/>(createSession)"]
    AUTH_SESSION --> REGISTER["register Handlers"]

    REGISTER --> TOOLS["ListTools / CallTool<br/>20 MCP tools"]
    REGISTER --> RESOURCES["ListResources / ReadResource<br/>skills docs"]
    REGISTER --> PROMPTS["ListPrompts / GetPrompt<br/>comandos invocaveis"]

    TOOLS --> TOOL_CTX["ToolContext<br/>(gateway + user + config)"]
    TOOL_CTX --> GATEWAY["SupabaseAdapter<br/>(PostgREST)"]

    REGISTER --> AUTOPULL["runAutoPull()<br/>se NIO_AUTO_PULL != 0"]
    AUTOPULL --> PROVISION["provision()<br/>skills -> opencode.json"]

    CONNECT(["connect(StdioServerTransport)"])
```

---

## 4. Fluxo `nio init`
Wizard interativo de 11 etapas.

[🎨 Editar](https://l.mermaid.ai/zKRRt6)

```mermaid
flowchart TD
    START(["nio init"]) --> CONFIRM["confirmOverwriteIfExists<br/>nio.json"]
    CONFIRM --> CORE["ensureCoreClients<br/>(OpenCode)"]
    CORE --> AUTH["auth-step<br/>PAT login opcional"]
    AUTH --> PROJECT["project-step<br/>pick/list projeto NOS"]
    PROJECT --> CONTEXT["context-step<br/>carregar contexto"]
    CONTEXT --> CLIENTS["clients-step<br/>OpenCode (global)"]
    CLIENTS --> PROVISION["provision-step<br/>skills -> target"]
    PROVISION --> DEPS["offerDependencyInstall"]
    DEPS --> REPORT["renderReport()"]
    REPORT --> WRITE["writeProjectConfig<br/>nio.json"]
    WRITE --> END(["pronto!"])
```

---

# Gateway de Segurança

## 5. Arquitetura do Gateway de Auth
8 arquivos do módulo `src/gateway/` + Edge Filter.

[🎨 Editar](https://l.mermaid.ai/f0W5ML)

```mermaid
flowchart TB
    subgraph Edge["Edge Filter"]
        WORKER["workers/edge-filter/src/index.ts"]
    end
    subgraph GW["Auth Gateway (src/gateway/)"]
        S["server.ts (Bun.serve :8787)"]
        T["types.ts (GatewayUser, responses)"]
        P["pkce.ts (verifier, challenge, state)"]
        PG["authorize-page.ts (HTML form)"]
        ST["authorize-store.ts (codes 5min)"]
        SS["sessions.ts (12h TTL)"]
        TR["traceability.ts (log stderr)"]
    end
    S --> T & P & PG & ST & SS & TR
    ST --> P
    SS --> T
    Edge -->|proxy| S
```

---

## 6. Fluxo OAuth2 PKCE
Sequência completa: CLI → navegador → autorização → troca por token.

[🎨 Editar](https://l.mermaid.ai/aVzij7)

```mermaid
sequenceDiagram
    participant CLI as CLI
    participant Browser as Browser
    participant GW as Auth Gateway
    participant Store as authorize-store
    participant SS as sessions

    CLI->>CLI: generateVerifier() + state
    CLI->>Browser: open /authorize?challenge=CHALLENGE&state=S
    Browser->>GW: GET /authorize
    GW->>GW: validate params (loopback, S256)
    GW-->>Browser: HTML form (email)
    Browser->>GW: POST /authorize (email)
    GW->>Store: createAuthorizationCode()
    Store-->>GW: code = UUID
    GW-->>Browser: 302 redirect (code + state)
    Browser-->>CLI: callback (code + state)
    CLI->>CLI: verify state
    CLI->>GW: POST /token (code + verifier)
    GW->>Store: consumeAuthorizationCode(code)
    Store-->>GW: PendingAuthorization
    GW->>GW: SHA256(verifier) == codeChallenge?
    alt valid
        GW->>SS: createSession(user)
        SS-->>GW: { token, expiresIn }
        GW-->>CLI: { approved: true, token }
    else invalid
        GW-->>CLI: { approved: false }
    end
```

---

## 7. Rotas HTTP e Validações
4 endpoints e suas validações de parâmetros e respostas de erro.

[🎨 Editar](https://l.mermaid.ai/CLCwsR)

```mermaid
flowchart LR
    subgraph Rotas["ROTAS DO AUTH GATEWAY"]
        direction TB

        subgraph Authorize["/authorize"]
            GET_A["GET<br/>handleAuthorizeGet()"]
            POST_A["POST<br/>handleAuthorizePost()"]
        end

        TOKEN["POST /token<br/>handleToken()"]
        VALIDATE["POST /auth/validate<br/>handleValidate()"]
        LOGOUT["POST /auth/logout<br/>handleLogout()"]
    end

    subgraph Validations["VALIDAÇÕES"]
        direction TB
        V1["response_type=code<br/>method=S256"]
        V2["client_id, redirect_uri,<br/>code_challenge, state obrigatórios"]
        V3["redirect_uri loopback<br/>(localhost/127.0.0.1)"]
        V4["code + verifier +<br/>redirect_uri obrigatórios"]
        V5["PKCE: SHA256(verifier)<br/>=== codeChallenge"]
        V6["code uso único<br/>(já consumido)"]
        V7["token presente?"]
        V8["token na sessão?<br/>não expirou?"]
    end

    GET_A --> V1 --> V2 --> V3 -->|"ok"| HTML["renderAuthorizePage()<br/>HTML 200"]
    POST_A --> V2 --> V3 -->|"ok"| CODE["createAuthorizationCode()<br/>302 redirect"]
    TOKEN --> V4 -->|"ok"| V5 -->|"ok"| V6 -->|"code válido"| SESS["createSession()<br/>{ approved, token }"]
    VALIDATE --> V7 -->|"ok"| V8 -->|"válida"| OK1["{ approved: true, user }"]
    LOGOUT --> V7 -->|"ok"| REVOKE["revokeSession()<br/>{ ok: true }"]

    V1 -.->|"falha"| E400["400 unsupported_response_type"]
    V2 -.->|"falha"| E400_2["400 invalid_request"]
    V3 -.->|"falha"| E400_3["400 invalid_request"]
    V5 -.->|"PKCE mismatch"| E400_4["400 PKCE inválido"]
    V6 -.->|"code inválido"| E400_5["400 code inválido/expirado"]
    V7 -.->|"ausente"| E400_6["400 token ausente"]
    V8 -.->|"inválida/expirada"| E401["401 não autorizado"]
```

---

## 8. Ciclo de Vida da Sessão
Sessões em memória: createSession, validateSession, revokeSession.

[🎨 Editar](https://l.mermaid.ai/5VHJBH)

```mermaid
flowchart LR
    subgraph Mem["In-Memory Maps"]
        BT["byToken: token → SessionRecord"]
        BU["byUser: userId → token (1 active)"]
    end
    subgraph Fn["Functions"]
        C["createSession(user)<br/>invalidates prior session"]
        V["validateSession(token)<br/>null if expired/missing"]
        R["revokeSession(token)<br/>true if revoked"]
    end
    subgraph TTL["Config"]
        T["SESSION_TTL_MS = 12h"]
    end
    C --> BT & BU
    V --> BT
    R --> BT & BU
```

---

## 9. Ciclo do Código de Autorização PKCE
Geração do verifier/challenge, criação e consumo do código de uso único.

[🎨 Editar](https://l.mermaid.ai/BMvovz)

```mermaid
flowchart TD
    subgraph PKCE["PKCE (pkce.ts)"]
        VF["generateVerifier() randomBytes(32)"]
        CH["challengeFromVerifier() SHA256 base64url"]
        ST["randomState() randomBytes(16)"]
    end
    subgraph Store["authorize-store.ts"]
        CR["createAuthorizationCode() → UUID (5min TTL)"]
        CO["consumeAuthorizationCode() single-use, deletes entry"]
    end
    subgraph Steps["Flow"]
        S1["CLI: verifier + challenge + state"]
        S2["GET /authorize: send challenge"]
        S3["POST /authorize: code created"]
        S4["POST /token: send verifier"]
        S5["Server: SHA256(verifier)==challenge?"]
    end
    VF --> CH
    CH --> S1 --> S2 --> S3 --> CR
    ST --> S1
    S4 --> CO --> S5
    S5 -->|match| OK["session created"]
    S5 -->|fail| NO["PKCE rejected"]
```

---

## 10. Malha de Segurança (Visão Geral)
Relação entre CLI auth, MCP Server, Data Gateway (core/ports), Supabase Adapter, Auth Gateway e Edge Filter.

[🎨 Editar](https://l.mermaid.ai/OPl7qV)

```mermaid
flowchart TB
    subgraph CLI_LAYER["CLI - src/"]
        AUTH_TS["src/auth.ts<br/>exchangePatForJwt()<br/>loadCredentials() / saveCredentials()<br/>resolveIdentity()"]
        CONSTANTS["src/constants.ts<br/>TOKEN_EXCHANGE_URL (Supabase)<br/>CREDENTIALS_FILE"]
        BRAND["src/brand.ts<br/>supabaseUrl, supabaseAnonKey<br/>projectConfigFile"]
    end

    subgraph MCP_SERVER["MCP Server"]
        MCP["src/mcp-server.ts<br/>ToolContext { gateway, user, config }"]
        SESSION_FACTORY["src/session-factory.ts<br/>createSession() → Session { user, gateway }"]
    end

    subgraph DATA_GATEWAY["Data Gateway (core/ports.ts)"]
        GW_INTERFACE["Gateway interface<br/>extends ContextGateway<br/>extends TaskGateway<br/>extends AllocationGateway<br/>extends AnalyticsGateway"]
    end

    subgraph SUPABASE_ADAPTER["Supabase Adapter"]
        CLIENT["adapters/supabase/client.ts<br/>createAuthenticatedClient()<br/>PAT → JWT → SupabaseClient"]
        GW_IMPL["adapters/supabase/gateway.ts<br/>createSupabaseGateway()<br/>compõe 4 gateways de domínio"]
        CONTEXT_GW["context-gateway.ts"]
        TASK_GW["task-gateway.ts"]
        ALLOC_GW["allocation-gateway.ts"]
        ANALYTICS_GW["analytics-gateway.ts"]
    end

    subgraph AUTH_GATEWAY["Auth Gateway (OAuth2 PKCE)"]
        GW_SERVER["src/gateway/server.ts<br/>Bun.serve() localhost:8787"]
        GW_TYPES["types.ts"]
        GW_PKCE["pkce.ts"]
        GW_PAGE["authorize-page.ts"]
        GW_STORE["authorize-store.ts"]
        GW_SESSIONS["sessions.ts"]
        GW_TRACE["traceability.ts"]
    end

    subgraph EDGE["Edge Filter"]
        WORKER["workers/edge-filter/src/index.ts<br/>Cloudflare Worker<br/>traceability + proxy"]
    end

    subgraph SUPABASE["Supabase (NOS)"]
        POSTGREST["PostgREST API<br/>tasks, projects, users,<br/>allocations, ..."]
    end

    AUTH_TS --> CONSTANTS
    AUTH_TS --> BRAND
    AUTH_TS -->|"PAT → jwt"| SUPABASE
    MCP --> SESSION_FACTORY
    SESSION_FACTORY --> CLIENT
    SESSION_FACTORY --> GW_INTERFACE
    CLIENT -->|"PAT login"| SUPABASE
    GW_IMPL --> GW_INTERFACE
    GW_IMPL --> CLIENT
    GW_IMPL --> CONTEXT_GW
    GW_IMPL --> TASK_GW
    GW_IMPL --> ALLOC_GW
    GW_IMPL --> ANALYTICS_GW
    EDGE -->|"proxy /authorize, /token"| GW_SERVER
    GW_SERVER --> GW_TYPES
    GW_SERVER --> GW_PKCE
    GW_SERVER --> GW_PAGE
    GW_SERVER --> GW_STORE
    GW_SERVER --> GW_SESSIONS
    GW_SERVER --> GW_TRACE
    AUTH_TS -.->|"futuro: TOKEN_EXCHANGE_URL aponta pro Gateway"| GW_SERVER

    classDef active fill:#2ecc71,color:#fff
    classDef paused fill:#f39c12,color:#fff
    classDef supabase fill:#3498db,color:#fff

    class AUTH_TS,CLIENT,GW_IMPL active
    class GW_SERVER,GW_TYPES,GW_PKCE,GW_PAGE,GW_STORE,GW_SESSIONS,GW_TRACE,WORKER paused
    class SUPABASE,POSTGREST supabase
```
